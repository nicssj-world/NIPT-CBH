import {readFile} from 'node:fs/promises';
import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {need,uuid,LabError,audit,type Staff} from './core';
import {savedSource,benchSource,benchPooling,benchExport,qcSourceHash} from './bench';
import type {WorkbookDeps} from '../workbook/service';
import {digest} from '../pooling/calculation';
import {exportOwnerTaskImport} from '../sequencing/owner-task-import';
const memberSchema=z.strictObject({slot:z.number().int().min(1).max(48),pooled:z.boolean(),actualVolume:z.number().finite().positive().optional(),reason:z.string().trim().max(500).optional()});
export async function recordActualPooling(db:Queryable,user:Staff,input:unknown,deps:WorkbookDeps){
 const d=z.strictObject({batchId:uuid,revision:z.number().int().positive(),members:z.array(memberSchema).length(48),note:z.string().trim().min(8).max(1000)}).parse(input);
 need(user,'qc.record');await db.query('SELECT id FROM lab_batch WHERE id=$1 FOR UPDATE',[d.batchId]);
 const s=await savedSource(db,user,d.batchId,deps);if(s.workbook.draft!.revision!==d.revision)throw new LabError('TASK_DRAFT_VERSION_CONFLICT',409);
 if(new Set(d.members.map(m=>m.slot)).size!==48)throw new LabError('ACTUAL_POOLING_POSITIONS_REQUIRED',422);
 const pool=await benchPooling(db,user,d.batchId,deps);
 const members=d.members.sort((a,b)=>a.slot-b.slot).map(m=>{
  const row=pool.calculation.rows.find(r=>r.slot===m.slot)!,slot=s.slots.find(r=>r.slot===m.slot)!;
  if(m.pooled&&(!row.sampleId||!slot.attemptId&&!slot.control))throw new LabError('ACTUAL_POOLING_EMPTY_POSITION',422,{slot:m.slot});
  if(m.pooled&&(row.csvVolume==='0'||row.belowTwo||row.volume===null)&&!(m.actualVolume&&m.reason&&m.reason.length>=8))throw new LabError('ACTUAL_TRANSFER_VOLUME_EVIDENCE_REQUIRED',422,{slot:m.slot});
  return {...m,sampleId:row.sampleId,attemptId:slot.attemptId??null,calculatedVolume:row.volume};
 });
 const qcValues=Object.fromEntries(Object.entries(s.workbook.values).filter(([k])=>/^slot\.\d+\.libraryQc$|^qc\.[123]\./.test(k)));
 const row=(await db.query<{id:string}>(`INSERT INTO lab_actual_pooling(batch_id,workbook_revision_id,qc_source_sha256,qc_values,placements,members,note,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[d.batchId,s.workbook.draft!.id,pool.sourceSha256,JSON.stringify(qcValues),JSON.stringify((s.workbook.draft!.source_snapshot as {placements:unknown}).placements),JSON.stringify(members),d.note,user.id])).rows[0];
 await audit(db,user,'LAB_ACTUAL_POOLING_RECORDED','lab_actual_pooling',row.id,{version:d.revision,outcome:'OPERATOR_RECORDED_ACTUAL_TRANSFER'});
 return {id:row.id,members,current:true};
}
type PairRow={id:string;batch_id:string;workbook_revision_id:string;actual_pooling_id:string;created_by:string;manifest:{halosPositions:number[];files:{id:string;kind:string;sha256:string;filename:string}[]}};
export async function readSeqPair(db:Queryable,user:Staff,id:string,deps:WorkbookDeps){
 const row=(await db.query<PairRow>('SELECT * FROM lab_seq_export_pair WHERE id=$1',[uuid.parse(id)])).rows[0];if(!row)throw new LabError('SEQ_EXPORT_NOT_FOUND',404);
 await benchSource(db,user,row.batch_id,deps);need(user,'handoff.create');
 return {id:row.id,...row.manifest};
}
export async function exportSeqPair(db:Queryable,user:Staff,input:unknown,deps:WorkbookDeps){
 const clickedAt=new Date();
 const d=z.strictObject({batchId:uuid,revision:z.number().int().positive(),idempotencyKey:uuid}).parse(input);need(user,'handoff.create');
 await db.query('SELECT id FROM lab_batch WHERE id=$1 FOR UPDATE',[d.batchId]);
 const s=await savedSource(db,user,d.batchId,deps);if(s.workbook.draft!.revision!==d.revision)throw new LabError('TASK_DRAFT_VERSION_CONFLICT',409);
 const prior=(await db.query<PairRow>('SELECT * FROM lab_seq_export_pair WHERE batch_id=$1 AND idempotency_key=$2',[d.batchId,d.idempotencyKey])).rows[0];
 if(prior){if(prior.workbook_revision_id!==s.workbook.draft!.id||prior.created_by!==user.id)throw new LabError('IDEMPOTENCY_CONFLICT',409);if(!(await db.query<{current:boolean}>('SELECT lab_actual_pooling_current($1) current',[prior.actual_pooling_id])).rows[0].current)throw new LabError('ACTUAL_POOLING_REQUIRED',409);return {id:prior.id,...prior.manifest};}
 const actual=(await db.query<{id:string;qc_source_sha256:string;members:(z.infer<typeof memberSchema>&{sampleId:string;attemptId:string|null})[];current:boolean}>(`SELECT *,lab_actual_pooling_current(id) current FROM lab_actual_pooling WHERE batch_id=$1 ORDER BY recorded_at DESC,id DESC LIMIT 1`,[d.batchId])).rows[0];
 if(!actual?.current||actual.qc_source_sha256!==qcSourceHash(s.slots,s.workbook.values))throw new LabError('ACTUAL_POOLING_REQUIRED',409);
 const members=actual.members.filter(m=>m.pooled).map(m=>{
  const slot=s.slots.find(s=>s.slot===m.slot),sampleId=slot?.printedSampleId??slot?.printedControlId;
  if(!slot||sampleId!==m.sampleId||(slot.attemptId??null)!==m.attemptId)throw new LabError('ACTUAL_POOLING_MAPPING_STALE',409);
  return {slot:m.slot,sampleId};
 });
 const template=process.env.NIPT_HALOS_TASK_TEMPLATE;if(!template)throw new LabError('TASK_IMPORT_TEMPLATE_REQUIRED',409);
 const halos=exportOwnerTaskImport(await readFile(template),members,clickedAt);
 // Both records and the pair manifest commit atomically. A failure cannot report two successful files.
 const nifty=await benchExport(db,user,{batchId:d.batchId,revision:d.revision,kind:'NIFTY_XLSX'},deps),halosHash=await deps.store.put(halos.bytes);
 const h=(await db.query<{id:string}>(`INSERT INTO lab_bench_export(batch_id,workbook_revision_id,kind,source_sha256,file_sha256,mapping,created_by) VALUES($1,$2,'HALOS_TASK_XLSX',$3,$4,$5,$6) RETURNING id`,[d.batchId,s.workbook.draft!.id,digest({pool:actual.id,revision:s.workbook.draft!.id,clickedAt:clickedAt.toISOString(),members}),halosHash,JSON.stringify(halos.mapping),user.id])).rows[0];
 const manifest={revision:d.revision,workbookRevisionId:s.workbook.draft!.id,actualPoolingId:actual.id,poolingSourceSha256:actual.qc_source_sha256,clickedAt:clickedAt.toISOString(),halosPositions:members.map(m=>m.slot),files:[{id:nifty.id,kind:'NIFTY_XLSX',sha256:nifty.sha256,filename:`NIFTY-${nifty.id}.xlsx`},{id:h.id,kind:'HALOS_TASK_XLSX',sha256:halosHash,filename:`HALOS-Task-Import-${h.id}.xlsx`}]};
 const pair=(await db.query<{id:string}>(`INSERT INTO lab_seq_export_pair(batch_id,workbook_revision_id,actual_pooling_id,nifty_export_id,halos_export_id,idempotency_key,manifest,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[d.batchId,s.workbook.draft!.id,actual.id,nifty.id,h.id,d.idempotencyKey,JSON.stringify(manifest),user.id])).rows[0];
 await audit(db,user,'LAB_SEQ_DUAL_EXPORTED','lab_seq_export_pair',pair.id,{version:d.revision,outcome:'TWO_XLSX_SAME_SOURCE'});return {id:pair.id,...manifest};
}
export async function downloadSeqFile(db:Queryable,user:Staff,pairId:string,fileId:string,deps:WorkbookDeps){
 const pair=await readSeqPair(db,user,pairId,deps),file=pair.files.find(f=>f.id===uuid.parse(fileId));if(!file)throw new LabError('SEQ_EXPORT_NOT_FOUND',404);
 const bytes=await deps.store.get(file.sha256);await audit(db,user,'LAB_SEQ_FILE_DOWNLOADED','lab_seq_export_pair',pairId,{outcome:file.kind});return {...file,bytes};
}
