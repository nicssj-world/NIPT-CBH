import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {appendAudit} from '../db/audit';
import {assertSession,need,uuid,LabError,type Staff} from '../lab/core';
import {lockBatch,type PlacementPayload} from '../lab/batch';
import {digest} from '../pooling/calculation';
import {type FileStore} from '../storage';
import {generateTaskWorkbook,inspectTaskMaster,MASTER_SHA256,validateTaskValues,SHEETS} from './master';
import type {exportTaskPdfs} from './native-pdf';
import type {DnbRow,SequenceRow,DnbObservation,DnbEvent} from '../sequencing/service';
import type {Observation as PoolObservation} from '../pooling/service';
type Revision={id:string;batch_id:string;revision:number;master_sha256:string;source_sha256:string;source_snapshot:unknown;values:Record<string,unknown>;created_by:string;created_at:Date};
export type WorkbookDeps={master:Buffer;store:Pick<FileStore,'put'|'get'>;render:typeof exportTaskPdfs};
async function access(db:Queryable,user:Staff,batchId:string,write=false) {await assertSession(db,user);need(user,write?'execution.record':'worksheet.read',write?'write':'read');return lockBatch(db,batchId);}
/** Frozen current placement/observations provide the automatic values. Manual draft cells never replace these source values. */
async function source(db:Queryable,batchId:string) {
  const placements=(await db.query<{id:string;revision:number;content_hash:string;payload:PlacementPayload}>(`SELECT DISTINCT ON(s.sheet_number) p.id,p.revision,p.content_hash,p.payload FROM lab_placement_snapshot p JOIN lab_task_sheet s ON s.id=p.sheet_id WHERE s.batch_id=$1 ORDER BY s.sheet_number,p.revision DESC`,[batchId])).rows;
  const observations=(await db.query<{id:string;sequence:number;sheet_number:number|null;slot_number:number|null;field_id:string;item:string;value:Record<string,unknown>;recorded_by:string}>(`SELECT o.id,o.sequence,s.sheet_number,o.slot_number,o.field_id,o.item,o.value,o.recorded_by FROM lab_observation o LEFT JOIN lab_task_sheet s ON s.id=o.sheet_id WHERE o.batch_id=$1 AND o.status<>'Superseded' ORDER BY o.sequence`,[batchId])).rows;
  const values:Record<string,unknown>={};
  for(const p of placements) {
    if(digest(p.payload)!==p.content_hash)throw new LabError('TASK_PLACEMENT_HASH_MISMATCH',409);
    const n=p.payload.sheetNumber;values[`task.${n}.run`]=p.payload.runLabel;values[`task.${n}.date`]=p.payload.plan.workDate;
    if(p.payload.plan.operator)values[`task.${n}.operator`]=p.payload.plan.operator;
    if(p.payload.plan.extractionLot)values[`task.${n}.extractionLotExp`]=`${p.payload.plan.extractionLot} / ${p.payload.plan.extractionExpiry??''}`;
    if(p.payload.plan.libraryLot)values[`task.${n}.libraryLotExp`]=`${p.payload.plan.libraryLot} / ${p.payload.plan.libraryExpiry??''}`;
    for(const slot of p.payload.slots)if(slot.attemptId||slot.control)values[`slot.${slot.slot}.printedSampleId`]=slot.printedSampleId??slot.printedControlId??'';
  }
  for(const o of observations) {
    if(o.field_id==='F3-03'&&o.slot_number&&typeof o.value.value==='string')values[`slot.${o.slot_number}.libraryQc`]=Number(o.value.value);
    if(o.field_id==='F2-11'&&o.slot_number&&o.value.before===true&&o.value.after===true)values[`slot.${o.slot_number}.transferChecked`]='✓';
    if(o.field_id==='F2-02'&&o.sheet_number&&typeof o.value.date==='string')values[`task.${o.sheet_number}.date`]=o.value.date;
    if(o.field_id==='F2-05'&&o.sheet_number&&typeof o.value.text==='string')values[`task.${o.sheet_number}.operator`]=o.value.text;
  }
  const pools=(await db.query('SELECT * FROM p4b_pool_snapshot WHERE pool_id IN (SELECT id FROM p4b_pool_attempt WHERE batch_id=$1) ORDER BY pool_id,revision',[batchId])).rows;
  const dnbs=(await db.query<DnbRow>('SELECT * FROM p4c_dnb_attempt WHERE batch_id=$1 ORDER BY attempt_number',[batchId])).rows;
  const sequencing=(await db.query<SequenceRow>('SELECT * FROM p4c_sequencing_attempt WHERE dnb_id IN (SELECT id FROM p4c_dnb_attempt WHERE batch_id=$1) ORDER BY dnb_id,attempt_number',[batchId])).rows;
  const dnb=dnbs.at(-1),dnbObservations=dnb?(await db.query<DnbObservation>(`SELECT o.* FROM p4c_dnb_observation o WHERE o.dnb_id=$1 AND NOT EXISTS(SELECT 1 FROM p4c_dnb_observation next WHERE next.supersedes_id=o.id) ORDER BY o.sequence`,[dnb.id])).rows:[];
  const dnbEvents=dnb?(await db.query<DnbEvent>('SELECT * FROM p4c_dnb_event WHERE dnb_id=$1 ORDER BY sequence',[dnb.id])).rows:[];
  if(dnb){
    values['seq.dnbId']=dnb.dnb_label;
    for(const [field,key] of [['STD1','seq.standard1'],['STD2','seq.standard2'],['QC3','seq.dnbConcentration']] as const){const o=dnbObservations.findLast(o=>o.field===field);if(o)values[key]=Number(o.value);}
    const sequence=sequencing.filter(s=>s.dnb_id===dnb.id).at(-1);
    if(sequence){values['seq.negativePressureKpa']=Number(sequence.record.pressureKpa);const end=dnbEvents.findLast(e=>e.event_type==='SEQUENCE_END'&&e.payload.sequencingId===sequence.id);const cycle=end?.payload.firstCycle as Record<string,string>|undefined;for(const key of ['loadedDnb','q30','bic','fit'])if(cycle?.[key]!==undefined)values[`seq.${key}`]=Number(cycle[key]);}
  }
  // Pool observations belong to the snapshot selected by the current DNB. Never mix a different pool's QC into this form.
  const pool=dnb?pools.find(p=>p.id===dnb.pool_snapshot_id):pools.length===1?pools[0]:undefined;
  const poolPayload=pool?.payload as {qc2?:PoolObservation[]}|undefined;
  for(const [field,key] of [['STD1','pool.standard1'],['STD2','pool.standard2'],['QC2','pool.concentration']] as const){const o=poolPayload?.qc2?.findLast(o=>o.field===field);if(o?.value.value!==undefined)values[key]=Number(o.value.value);}
  const snapshot={placements,observations,pools,dnbs,sequencing,dnbObservations,dnbEvents};return {snapshot,sha256:digest(snapshot),values};
}
async function latest(db:Queryable,batchId:string){return (await db.query<Revision>('SELECT * FROM task_workbook_revision WHERE batch_id=$1 ORDER BY revision DESC LIMIT 1',[batchId])).rows[0]??null;}
export async function workbookWorkspace(db:Queryable,user:Staff,batchId:string,deps:WorkbookDeps) {
  const batch=await access(db,user,uuid.parse(batchId)),current=await source(db,batchId),draft=await latest(db,batchId);
  const exports=(await db.query(`SELECT e.id,e.format,e.sheet,e.file_sha256,e.manifest,e.created_by,e.created_at,r.revision FROM task_workbook_export e JOIN task_workbook_revision r ON r.id=e.revision_id WHERE r.batch_id=$1 ORDER BY e.created_at DESC`,[batchId])).rows;
  return {batchId,version:batch.version,masterSha256:MASTER_SHA256,matrix:inspectTaskMaster(deps.master),draft,sourceSha256:current.sha256,sourceStale:!!draft&&(draft.source_sha256!==current.sha256||draft.master_sha256!==MASTER_SHA256),automaticValues:current.values,values:{...(draft?.values??{}),...current.values},exports};
}
export async function saveWorkbookDraft(db:Queryable,user:Staff,input:unknown,deps:WorkbookDeps) {
  const d=z.strictObject({batchId:uuid,expectedVersion:z.number().int().min(0),expectedRevision:z.number().int().min(0),values:z.record(z.string(),z.unknown())}).parse(input);
  const batch=await access(db,user,d.batchId,true);if(batch.version!==d.expectedVersion)throw new LabError('VERSION_CONFLICT',409);
  const previous=await latest(db,batch.id);if((previous?.revision??0)!==d.expectedRevision)throw new LabError('TASK_DRAFT_VERSION_CONFLICT',409);
  const current=await source(db,batch.id);validateTaskValues(deps.master,d.values);
  for(const [key,value]of Object.entries(d.values))if((/^slot\.\d+\.printedSampleId$/.test(key)||/^task\.\d+\.run$/.test(key))&&JSON.stringify(value)!==JSON.stringify(current.values[key]))throw new LabError('TASK_SOURCE_FIELD_READ_ONLY',409,{key});
  for(const [key,value]of Object.entries(current.values))if(key in d.values&&JSON.stringify(d.values[key])!==JSON.stringify(value))throw new LabError('TASK_SOURCE_FIELD_READ_ONLY',409,{key});
  const values={...d.values,...current.values};validateTaskValues(deps.master,values);
  const row=(await db.query<Revision>('INSERT INTO task_workbook_revision(batch_id,revision,master_sha256,source_sha256,source_snapshot,values,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[batch.id,d.expectedRevision+1,MASTER_SHA256,current.sha256,JSON.stringify(current.snapshot),JSON.stringify(values),user.id])).rows[0];
  await appendAudit(db,{actorId:user.id,action:'TASK_WORKBOOK_DRAFT_SAVED',resourceType:'task_workbook_revision',resourceId:row.id,details:{version:row.revision,outcome:'DRAFT_SAVED'}});return row;
}
export async function exportWorkbook(db:Queryable,user:Staff,input:unknown,deps:WorkbookDeps) {
  const d=z.strictObject({batchId:uuid,revision:z.number().int().positive(),format:z.enum(['XLSX','PDF']),sheet:z.enum(SHEETS).optional()}).parse(input);
  await access(db,user,d.batchId,true);const draft=await latest(db,d.batchId);if(!draft||draft.revision!==d.revision)throw new LabError('TASK_CURRENT_DRAFT_REQUIRED',409);
  const current=await source(db,d.batchId);if(current.sha256!==draft.source_sha256||draft.master_sha256!==MASTER_SHA256)throw new LabError('TASK_SOURCE_CHANGED_REBIND_REQUIRED',409);
  const generated=generateTaskWorkbook(deps.master,draft.values);
  let bytes=generated.bytes,manifest:Record<string,unknown>={masterSha256:MASTER_SHA256,sourceSha256:current.sha256,revision:d.revision,xlsxSha256:generated.sha256,formulaCount:149,calculation:'native Excel recalculation required'};
  if(d.format==='PDF') {
    if(!d.sheet)throw new LabError('TASK_SHEET_REQUIRED',422);
    const pdfs=await deps.render(generated.bytes),pdf=pdfs.find(p=>p.sheet===d.sheet);if(!pdf)throw new LabError('TASK_NATIVE_PDF_MISSING',500);
    bytes=pdf.bytes;const {bytes:_,...evidence}=pdf;void _;manifest={...manifest,...evidence};
  }
  const fileHash=await deps.store.put(bytes);
  const row=(await db.query<{id:string}>('INSERT INTO task_workbook_export(revision_id,format,sheet,file_sha256,manifest,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[draft.id,d.format,d.format==='PDF'?d.sheet:null,fileHash,JSON.stringify(manifest),user.id])).rows[0];
  await appendAudit(db,{actorId:user.id,action:'TASK_WORKBOOK_EXPORTED',resourceType:'task_workbook_export',resourceId:row.id,details:{outcome:d.format,version:d.revision}});
  return {id:row.id,bytes,sha256:fileHash,manifest};
}
export async function downloadWorkbookExport(db:Queryable,user:Staff,id:string,deps:WorkbookDeps) {
  await assertSession(db,user);need(user,'worksheet.read','read');
  const row=(await db.query<{batch_id:string;format:string;sheet:string|null;file_sha256:string;manifest:unknown}>('SELECT e.*,r.batch_id FROM task_workbook_export e JOIN task_workbook_revision r ON r.id=e.revision_id WHERE e.id=$1',[uuid.parse(id)])).rows[0];
  if(!row)throw new LabError('NOT_FOUND',404);await access(db,user,row.batch_id);
  const bytes=await deps.store.get(row.file_sha256);await appendAudit(db,{actorId:user.id,action:'TASK_WORKBOOK_DOWNLOADED',resourceType:'task_workbook_export',resourceId:id,details:{outcome:'DOWNLOADED'}});return {...row,bytes};
}
