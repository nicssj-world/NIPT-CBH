import {z} from 'zod';
import type {Queryable} from '../db/connection';
import type {FileStore} from '../storage';
import {need,assertSession,audit,uuid,LabError,caseVisible,type Staff} from '../lab/core';
import {readHalosWorkbook,HalosAdapterError,type HalosRow,type HalosIssue} from './halos-adapter';

// HALOS result import (Task 3 pathway A). The original workbook is stored byte-for-byte first; every row is resolved only through
// the persisted frozen export mapping (lab_seq_export_pair HALOS file, or the older p4b_halos_export) — never by global suffix
// matching, row order or chip. Preview writes nothing that can be reported; confirmation freezes the reviewed classification.
export const HALOS_MAX_BYTES=8*1024*1024;
type Resolution={classification:'PATIENT'|'CONTROL'|'UNMATCHED'|'AMBIGUOUS'|'STALE_EXPORT'|'SUPERSEDED_ATTEMPT';reason:string;
 attemptId:string|null;roundId:string|null;caseId:string|null;exportKind:'LAB_SEQ_EXPORT_PAIR'|'P4B_HALOS_EXPORT'|null;exportId:string|null;mapping:Record<string,unknown>|null;vendorSampleId:string|null};
type Candidate={exportKind:'LAB_SEQ_EXPORT_PAIR'|'P4B_HALOS_EXPORT';exportId:string;createdAt:Date;current:boolean;entry:{attemptId:string|null;roundId:string|null;caseId:string|null;physicalSlot:number|null};vendorSampleId:string|null;batchId:string|null};
const CONTROL_ID=/^\d{2}N\d/;
async function candidatesFor(db:Queryable,key:string):Promise<Candidate[]>{
 const pair=(await db.query<{pair_id:string;batch_id:string;created_at:Date;current:boolean;entry:{attemptId:string|null;roundId:string|null;caseId:string|null;physicalSlot:number};vendor:string|null}>(
  `SELECT p.id pair_id,p.batch_id,p.created_at,lab_actual_pooling_current(p.actual_pooling_id) current,m entry,
    (SELECT x->>'vendorSampleId' FROM jsonb_array_elements(n.mapping) x WHERE x->>'attemptId'=m->>'attemptId' AND x->>'kind'='PATIENT' LIMIT 1) vendor
   FROM lab_seq_export_pair p JOIN lab_bench_export h ON h.id=p.halos_export_id AND h.kind='HALOS_TASK_XLSX' JOIN lab_bench_export n ON n.id=p.nifty_export_id
   CROSS JOIN LATERAL jsonb_array_elements(h.mapping) m WHERE m->>'sampleId'=$1`,[key])).rows;
 const older=(await db.query<{export_id:string;created_at:Date;attempt_id:string|null;round_id:string|null;case_id:string|null;slot:number;role:string;current:boolean}>(
  `SELECT e.id export_id,e.created_at,(m->>'physicalPosition')::int slot,m->>'role' role,s.member->>'attemptId' attempt_id,s.member->>'roundId' round_id,s.member->>'caseId' case_id,
    e.revision=(SELECT max(revision) FROM p4b_halos_export WHERE pool_snapshot_id=e.pool_snapshot_id) current
   FROM p4b_halos_export e CROSS JOIN LATERAL jsonb_array_elements(e.source->'members') m
   LEFT JOIN LATERAL (SELECT x member FROM p4b_pool_snapshot ps CROSS JOIN LATERAL jsonb_array_elements(ps.payload->'members') x WHERE ps.id=e.pool_snapshot_id AND (x->>'slot')::int=(m->>'physicalPosition')::int LIMIT 1) s ON true
   WHERE m->>'exportSampleId'=$1`,[key])).rows;
 return [...pair.map(r=>({exportKind:'LAB_SEQ_EXPORT_PAIR' as const,exportId:r.pair_id,createdAt:r.created_at,current:r.current,entry:{attemptId:r.entry.attemptId??null,roundId:r.entry.roundId??null,caseId:r.entry.caseId??null,physicalSlot:r.entry.physicalSlot??null},vendorSampleId:r.vendor,batchId:r.batch_id})),
  ...older.map(r=>({exportKind:'P4B_HALOS_EXPORT' as const,exportId:r.export_id,createdAt:r.created_at,current:r.current,entry:{attemptId:r.role==='PATIENT'?r.attempt_id:null,roundId:r.role==='PATIENT'?r.round_id:null,caseId:r.role==='PATIENT'?r.case_id:null,physicalSlot:r.slot},vendorSampleId:null,batchId:null}))];
}
/** Resolve one HALOS sample ID to exactly one persisted export member, or say precisely why not. */
export async function resolveSample(db:Queryable,key:string):Promise<Resolution>{
 const none={attemptId:null,roundId:null,caseId:null,exportKind:null,exportId:null,mapping:null,vendorSampleId:null};
 const found=await candidatesFor(db,key);
 if(!found.length)return {...none,...(CONTROL_ID.test(key)?{classification:'CONTROL',reason:'CONTROL_ID_NOT_IN_FROZEN_EXPORT'}:{classification:'UNMATCHED',reason:'NOT_IN_ANY_FROZEN_EXPORT'})};
 const attempts=new Set(found.map(c=>c.entry.attemptId??'CONTROL'));
 if(attempts.size>1)return {...none,classification:'AMBIGUOUS',reason:'SAMPLE_ID_MAPS_TO_DIFFERENT_MEMBERS'};
 // Re-export of the same member: the newest current export is the evidence of record.
 const chosen=[...found].sort((a,b)=>Number(b.current)-Number(a.current)||b.createdAt.getTime()-a.createdAt.getTime())[0];
 const base={exportKind:chosen.exportKind,exportId:chosen.exportId,vendorSampleId:chosen.vendorSampleId,mapping:{...chosen.entry,exportKind:chosen.exportKind,exportId:chosen.exportId,batchId:chosen.batchId,vendorSampleId:chosen.vendorSampleId}};
 if(!chosen.entry.attemptId)return {...base,attemptId:null,roundId:null,caseId:null,classification:'CONTROL',reason:'EXPORT_CONTROL_POSITION'};
 if(!chosen.current)return {...base,attemptId:chosen.entry.attemptId,roundId:chosen.entry.roundId,caseId:chosen.entry.caseId,classification:'STALE_EXPORT',reason:'EXPORT_POOLING_NO_LONGER_CURRENT'};
 const a=(await db.query<{state:string;latest:boolean;current_round:boolean;removed:boolean;round_id:string;case_id:string}>(
  `SELECT a.state,a.attempt_number=(SELECT max(b.attempt_number) FROM analytical_attempt b WHERE b.round_id=a.round_id) latest,c.current_round_id=a.round_id current_round,a.round_id,a.case_id,
    NOT EXISTS(SELECT 1 FROM lab_slot_assignment s WHERE s.attempt_id=a.id AND s.removed_at IS NULL) removed
   FROM analytical_attempt a JOIN nipt_case c ON c.id=a.case_id WHERE a.id=$1`,[chosen.entry.attemptId])).rows[0];
 if(!a||a.round_id!==chosen.entry.roundId||a.case_id!==chosen.entry.caseId)return {...base,attemptId:null,roundId:null,caseId:null,classification:'AMBIGUOUS',reason:'EXPORT_MEMBER_LINEAGE_MISMATCH'};
 const r={...base,attemptId:chosen.entry.attemptId,roundId:a.round_id,caseId:a.case_id};
 if(['Superseded','BatchCancelled','Stopped','Cancelled'].includes(a.state))return {...r,classification:'SUPERSEDED_ATTEMPT',reason:`ATTEMPT_${a.state.toUpperCase()}`};
 if(!a.latest)return {...r,classification:'SUPERSEDED_ATTEMPT',reason:'LATER_ATTEMPT_EXISTS'};
 if(!a.current_round)return {...r,classification:'SUPERSEDED_ATTEMPT',reason:'ROUND_NOT_CURRENT'};
 if(a.removed&&chosen.exportKind==='LAB_SEQ_EXPORT_PAIR')return {...r,classification:'STALE_EXPORT',reason:'ATTEMPT_REMOVED_FROM_BATCH'};
 return {...r,classification:'PATIENT',reason:'FROZEN_EXPORT_MEMBER'};
}

const ANALYTIC_KEYS=['sampleQc','operationAdvice','physicianAdvice','testChr13','testChr18','testChr21','testSex','fetalFraction','risk13','risk18','risk21','gender','chipId','laneId','barcodeId','testOther','disease','testCnv'] as const;
const sameAnalysis=(a:HalosRow,b:HalosRow)=>ANALYTIC_KEYS.every(k=>(a.values[k]??'').trim()===(b.values[k]??'').trim());
type Planned={row:HalosRow;classification:string;reason:string;res:Resolution|null;primaryIndex:number|null;infoIndex:number|null};
async function classify(db:Queryable,rows:HalosRow[]){
 const planned:Planned[]=rows.map(row=>({row,classification:row.sheet==='sampleinfo'?'SAMPLE_INFO':'INVALID',reason:row.invalid??'PENDING',res:null,primaryIndex:null,infoIndex:null}));
 const results=planned.filter(p=>p.row.sheet==='result'&&!p.row.invalid),count=new Map<string,number>();
 for(const p of results)count.set(p.row.sampleKey,(count.get(p.row.sampleKey)??0)+1);
 for(const p of results){
  if(count.get(p.row.sampleKey)!>1){p.classification='AMBIGUOUS';p.reason='DUPLICATE_SAMPLE_IN_RESULT_SHEET';continue;}
  p.res=await resolveSample(db,p.row.sampleKey);p.classification=p.res.classification;p.reason=p.res.reason;
 }
 for(const p of planned.filter(x=>x.row.sheet==='repeat'&&!x.row.invalid)){
  const primary=planned.findIndex(x=>x.row.sheet==='result'&&x.row.sampleKey===p.row.sampleKey);
  p.res=await resolveSample(db,p.row.sampleKey);
  if(primary>=0){p.primaryIndex=primary;
   if(sameAnalysis(planned[primary].row,p.row)){p.classification='DUPLICATE_ENTRY';p.reason='SAME_AS_RESULT_SHEET_ROW';}
   else{p.classification='AMBIGUOUS';p.reason='RESULT_AND_REPEAT_VALUES_DIFFER';const q=planned[primary];if(q.classification==='PATIENT'){q.classification='AMBIGUOUS';q.reason='RESULT_AND_REPEAT_VALUES_DIFFER';}}}
  else{p.classification='REPEAT_HISTORY';p.reason=p.res.classification==='PATIENT'?'REPEAT_SHEET_ONLY':`REPEAT_SHEET_ONLY_${p.res.reason}`;}
 }
 // sampleinfo is joined through the frozen NIFTY vendor ID of the same export — never by stripping a suffix.
 const info=new Map<string,number[]>();planned.forEach((p,i)=>{if(p.row.sheet==='sampleinfo'&&!p.row.invalid)info.set(p.row.sampleKey,[...(info.get(p.row.sampleKey)??[]),i]);});
 for(const p of results){const v=p.res?.vendorSampleId;if(!v)continue;const hits=info.get(v)??[];if(hits.length===1)p.infoIndex=hits[0];}
 return planned;
}

const nameSchema=z.string().trim().min(1).max(255).refine(n=>/\.xlsx$/i.test(n)&&!/[\r\n\0/\\]/.test(n),'XLSX_NAME_INVALID');
/** Upload + read-only preview. Duplicate bytes reuse the live import; nothing here can create a report. */
export async function previewHalosImport(db:Queryable,user:Staff,store:FileStore,input:{name:string;bytes:Buffer}){
 await assertSession(db,user);need(user,'result.import');
 const name=nameSchema.parse(input.name.split(/[\\/]/).pop());
 if(!input.bytes.length)throw new LabError('EMPTY_FILE',422);if(input.bytes.length>HALOS_MAX_BYTES)throw new LabError('FILE_TOO_LARGE',422);
 let wb;try{wb=readHalosWorkbook(input.bytes);}catch(e){if(e instanceof HalosAdapterError)throw new LabError(e.message,422,e.details);throw e;}
 const hash=await store.put(input.bytes);
 await db.query("INSERT INTO file_asset(sha256,byte_size,media_type,storage_key) VALUES($1,$2,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',$3) ON CONFLICT(sha256) DO NOTHING",[hash,input.bytes.length,`sha256/${hash.slice(0,2)}/${hash.slice(2,4)}/${hash}`]);
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,75432860))',[hash]);
 const live=(await db.query<{id:string;state:string}>("SELECT id,state FROM halos_import WHERE sha256=$1 AND state<>'Cancelled'",[hash])).rows[0];
 if(live){await audit(db,user,'HALOS_IMPORT_DUPLICATE','HALOS_IMPORT',live.id,{outcome:live.state});return {...await readHalosImport(db,user,live.id),duplicate:true};}
 const issues:HalosIssue[]=[...wb.issues];
 const sameName=(await db.query<{id:string}>("SELECT id FROM halos_import WHERE lower(original_name)=lower($1) AND sha256<>$2 AND state<>'Cancelled'",[name,hash])).rows;
 if(sameName.length)issues.push({code:'NAME_COLLISION_DIFFERENT_CONTENT',severity:'WARNING',detail:sameName.map(r=>r.id).join(',')});
 const planned=await classify(db,wb.rows);
 const counts={...wb.counts,...Object.fromEntries(['PATIENT','CONTROL','UNMATCHED','AMBIGUOUS','STALE_EXPORT','SUPERSEDED_ATTEMPT','DUPLICATE_ENTRY','REPEAT_HISTORY','INVALID'].map(c=>[c,planned.filter(p=>p.classification===c).length]))};
 const id=(await db.query<{id:string}>('INSERT INTO halos_import(sha256,original_name,byte_size,adapter_version,chip_ids,counts,issues,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
  [hash,name,input.bytes.length,wb.adapterVersion,wb.chipIds,JSON.stringify(counts),JSON.stringify(issues),user.id])).rows[0].id;
 const ids:string[]=[];
 // sampleinfo rows first so result rows can reference them; repeat rows reference their result-sheet row.
 const order=[...planned.keys()].sort((a,b)=>(['sampleinfo','result','repeat'].indexOf(planned[a].row.sheet)-['sampleinfo','result','repeat'].indexOf(planned[b].row.sheet))||a-b);
 for(const i of order){const p=planned[i],r=p.res;
  ids[i]=(await db.query<{id:string}>(`INSERT INTO halos_import_row(import_id,sheet,row_number,raw,sample_raw,sample_key,chip_id,lane_id,barcode,classification,reason,attempt_id,round_id,case_id,export_kind,export_id,mapping,primary_row_id,sampleinfo_row_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,[id,p.row.sheet,p.row.rowNumber,JSON.stringify(p.row.raw),p.row.sampleRaw.slice(0,120),p.row.sampleKey.slice(0,120),p.row.values.chipId?.trim()||null,p.row.values.laneId?.trim()||null,p.row.values.barcodeId?.trim()||null,
   p.classification,p.reason,p.classification==='CONTROL'?null:r?.attemptId??null,p.classification==='CONTROL'?null:r?.roundId??null,p.classification==='CONTROL'?null:r?.caseId??null,r?.exportKind??null,r?.exportId??null,r?.mapping?JSON.stringify(r.mapping):null,
   p.primaryIndex!==null?ids[p.primaryIndex]:null,p.infoIndex!==null?ids[p.infoIndex]:null])).rows[0].id;}
 await audit(db,user,'HALOS_IMPORT_PREVIEWED','HALOS_IMPORT',id,{outcome:'PREVIEWED',count:wb.counts.result});
 return {...await readHalosImport(db,user,id),duplicate:false};
}

export async function readHalosImport(db:Queryable,user:Staff,id:string){
 need(user,'result.review','read');
 const i=(await db.query<{id:string;sha256:string;original_name:string;byte_size:string;adapter_version:string;chip_ids:string[];counts:Record<string,number>;issues:HalosIssue[];state:string;uploaded_by:string;uploader:string;uploaded_at:Date;decided_at:Date|null;decider:string|null;row_version:number}>(
  'SELECT i.*,u.display_name uploader,d.display_name decider FROM halos_import i JOIN app_user u ON u.id=i.uploaded_by LEFT JOIN app_user d ON d.id=i.decided_by WHERE i.id=$1',[uuid.parse(id)])).rows[0];
 if(!i)throw new LabError('NOT_FOUND',404);
 const rows=(await db.query<{id:string;sheet:string;row_number:number;sample_raw:string;sample_key:string;chip_id:string|null;classification:string;reason:string;attempt_id:string|null;case_id:string|null;round_id:string|null;export_kind:string|null;
  primary_row_id:string|null;ln:string|null;ln_halos:string|null;attempt_number:number|null;unit_id:string|null;registration_origin:string|null;qc:string|null;advice:string|null;t21:string|null}>(
  `SELECT r.id,r.sheet,r.row_number,r.sample_raw,r.sample_key,r.chip_id,r.classification,r.reason,r.attempt_id,r.case_id,r.round_id,r.export_kind,r.primary_row_id,l.ln,n.ln_halos,a.attempt_number,
    (SELECT s.unit_id FROM case_unit_scope s WHERE s.case_id=r.case_id ORDER BY s.unit_id LIMIT 1) unit_id,c.registration_origin,r.raw->>'Sample QC' qc,r.raw->>'Operation advice' advice,r.raw->>'Test(chr21)' t21
   FROM halos_import_row r LEFT JOIN analytical_attempt a ON a.id=r.attempt_id LEFT JOIN specimen_round_current sr ON sr.id=r.round_id LEFT JOIN case_ln l ON l.id=sr.case_ln_id
   LEFT JOIN specimen_lab_number n ON n.round_id=r.round_id LEFT JOIN nipt_case c ON c.id=r.case_id
   WHERE r.import_id=$1 ORDER BY CASE r.sheet WHEN 'result' THEN 0 WHEN 'repeat' THEN 1 ELSE 2 END,r.row_number`,[i.id])).rows;
 // Identity of a matched row is shown only within the user's case scope; the row itself stays visible as a count.
 return {id:i.id,sha256:i.sha256,name:i.original_name,size:Number(i.byte_size),adapterVersion:i.adapter_version,chipIds:i.chip_ids,counts:i.counts,issues:i.issues,state:i.state,rowVersion:i.row_version,
  uploadedBy:i.uploader,uploadedAt:i.uploaded_at,decidedBy:i.decider,decidedAt:i.decided_at,
  rows:rows.map(r=>{const visible=!r.case_id||caseVisible(user,{unit_id:r.unit_id,registration_origin:r.registration_origin??'ANC'});
   return {id:r.id,sheet:r.sheet,row:r.row_number,sample:r.sample_raw,sampleKey:r.sample_key,chip:r.chip_id,classification:r.classification,reason:r.reason,exportKind:r.export_kind,primaryRowId:r.primary_row_id,
    qc:r.qc,advice:r.advice,t21:r.t21,...(visible?{caseId:r.case_id,roundId:r.round_id,attemptId:r.attempt_id,ln:r.ln,lnHalos:r.ln_halos,attemptNumber:r.attempt_number}:{caseId:null,roundId:null,attemptId:null,ln:null,lnHalos:null,attemptNumber:null})};})};
}

/** Confirm freezes the preview. Warnings (mixed chip, name collision, absent repeat sheet) need an explicit acknowledgement. */
export async function decideHalosImport(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'result.import');
 const d=z.strictObject({importId:uuid,decision:z.enum(['CONFIRM','CANCEL']),expectedRowVersion:z.number().int().min(0),acknowledgeWarnings:z.array(z.string().regex(/^[A-Z0-9_]{2,80}$/)).max(20).default([])}).parse(input);
 const i=(await db.query<{id:string;state:string;row_version:number;issues:HalosIssue[]}>('SELECT id,state,row_version,issues FROM halos_import WHERE id=$1 FOR UPDATE',[d.importId])).rows[0];
 if(!i)throw new LabError('NOT_FOUND',404);
 const target=d.decision==='CONFIRM'?'Confirmed':'Cancelled';
 if(i.state===target)return readHalosImport(db,user,i.id);
 if(i.state!=='Previewed')throw new LabError('HALOS_IMPORT_ALREADY_DECIDED',409,{state:i.state});
 if(i.row_version!==d.expectedRowVersion)throw new LabError('VERSION_CONFLICT',409);
 if(d.decision==='CONFIRM'){
  const pending=[...new Set(i.issues.filter(x=>x.severity==='WARNING').map(x=>x.code))].filter(c=>!d.acknowledgeWarnings.includes(c));
  if(pending.length)throw new LabError('HALOS_WARNINGS_ACK_REQUIRED',409,{codes:pending});
 }
 await db.query('UPDATE halos_import SET state=$2,decided_by=$3,decided_at=clock_timestamp(),row_version=row_version+1 WHERE id=$1',[i.id,target,user.id]);
 await audit(db,user,d.decision==='CONFIRM'?'HALOS_IMPORT_CONFIRMED':'HALOS_IMPORT_CANCELLED','HALOS_IMPORT',i.id,{outcome:target});
 return readHalosImport(db,user,i.id);
}
export async function listHalosImports(db:Queryable,user:Staff){
 need(user,'result.review','read');
 return (await db.query(`SELECT i.id,i.original_name name,i.sha256,i.state,i.chip_ids "chipIds",i.counts,i.uploaded_at "uploadedAt",u.display_name "uploadedBy" FROM halos_import i JOIN app_user u ON u.id=i.uploaded_by ORDER BY i.uploaded_at DESC LIMIT 50`)).rows;
}
/** The archived original, exactly as uploaded. Authorised LAB readers only; every read is audited. */
export async function readHalosSource(db:Queryable,user:Staff,store:FileStore,id:string){
 await assertSession(db,user);need(user,'result.review','read');
 const i=(await db.query<{sha256:string;original_name:string}>('SELECT sha256,original_name FROM halos_import WHERE id=$1',[uuid.parse(id)])).rows[0];if(!i)throw new LabError('NOT_FOUND',404);
 await db.query("INSERT INTO result_access_log(actor_id,purpose) VALUES($1,'LAB_HALOS_SOURCE_FILE')",[user.id]);
 await audit(db,user,'HALOS_SOURCE_DOWNLOADED','HALOS_IMPORT',id,{outcome:'ORIGINAL_BYTES'});
 return {bytes:await store.get(i.sha256),sha256:i.sha256,name:i.original_name};
}
