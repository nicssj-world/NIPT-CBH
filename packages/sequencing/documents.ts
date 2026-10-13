import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {sha256,type FileStore} from '../storage';
import {LabError,need,assertSession,uuid,reasonText,audit,type Staff} from '../lab/core';
import {digest} from '../pooling/calculation';
import type {Member} from '../pooling/service';
import {F5_FIELDS,type F5Document} from '../pdf/f5';
import {HOLDS} from './schemas';
import {context,storedPool,qc3Evidence,qc4Evidence} from './service';
export type F5Deps={store:FileStore;render:(doc:F5Document)=>Promise<Buffer>};
type Dnb={id:string;batch_id:string;pool_snapshot_id:string;attempt_number:number;revision:number;dnb_label:string;supersedes_id:string|null;preparation:Record<string,unknown>;payload:Record<string,unknown>;sha256:string;source_sha256:string;created_by:string;created_at:Date};
type Pool={id:string;pool_id:string;sha256:string;payload:{members:Member[];runLabel:string;calculation:{scenario:{controls:'PATIENT_ONLY'|'PATIENT_PC_NC'}}}};
type Ev={id:string;event_type:string;payload:Record<string,unknown>;actor_id:string|null;created_at:Date};
type Obs={id:string;field:string;value:string;review:{result:string;reviewer_id:string}|null;recorded_by:string};
type Run={id:string;record:Record<string,unknown>;attempt_number:number};
type QC4={id:string;scope:string;member_key:string|null;review:{result:string;reviewer_id:string}|null};
type Handoff={id:string;payload:{mappedMembers?:{physicalPosition:number;barcodeIndex:number;barcodeType:string}[]};revision:number};
type Doc={id:string;dnb_id:string;kind:'PRE_WORK'|'COMPLETED';revision:number;snapshot:F5Document;file_sha256:string};
const issueSchema=z.strictObject({batchId:uuid,dnbId:uuid,expectedVersion:z.number().int().nonnegative(),kind:z.enum(['PRE_WORK','COMPLETED']),purpose:z.literal('SYNTHETIC_SIMULATION')});
async function append(db:Queryable,user:Staff,id:string,type:string,payload:Record<string,unknown>){await db.query('INSERT INTO p4c_dnb_event(dnb_id,event_type,payload,actor_id) VALUES($1,$2,$3,$4)',[id,type,JSON.stringify(payload),user.id]);await audit(db,user,'F5_'+type,'p4c_dnb_attempt',id,{outcome:'SYNTHETIC_HOLD'});}
const touch=async(db:Queryable,id:string)=>(await db.query<{version:number}>('UPDATE lab_batch SET version=version+1 WHERE id=$1 RETURNING version',[id])).rows[0].version;
async function inputs(db:Queryable,id:string){
 const dnb=(await db.query<Dnb>('SELECT * FROM p4c_dnb_attempt WHERE id=$1',[id])).rows[0];if(!dnb)throw new LabError('NOT_FOUND',404);
 const pool=(await db.query<Pool>('SELECT * FROM p4b_pool_snapshot WHERE id=$1',[dnb.pool_snapshot_id])).rows[0];
 const events=(await db.query<Ev>('SELECT * FROM p4c_dnb_event WHERE dnb_id=$1 ORDER BY sequence',[id])).rows;
 const observations=(await db.query<Obs>(`SELECT o.*,(SELECT row_to_json(r) FROM p4c_dnb_review r WHERE r.observation_id=o.id) review FROM p4c_dnb_observation o WHERE dnb_id=$1 AND NOT EXISTS(SELECT 1 FROM p4c_dnb_observation x WHERE x.supersedes_id=o.id) ORDER BY sequence`,[id])).rows;
 const decision=(await db.query<{decision:string;observation_id:string}>('SELECT * FROM p4c_qc3_decision WHERE dnb_id=$1 ORDER BY sequence DESC LIMIT 1',[id])).rows[0]??null;
 const runs=(await db.query<Run>('SELECT * FROM p4c_sequencing_attempt WHERE dnb_id=$1 ORDER BY attempt_number',[id])).rows;
 const run=runs.at(-1)??null;
 const qc4=run?(await db.query<QC4>(`SELECT o.*,(SELECT row_to_json(r) FROM p4c_qc4_review r WHERE r.qc4_id=o.id) review FROM p4c_qc4_observation o WHERE sequencing_id=$1 AND NOT EXISTS(SELECT 1 FROM p4c_qc4_observation x WHERE x.supersedes_id=o.id) ORDER BY sequence`,[run.id])).rows:[];
 const handoffs=(await db.query<Handoff>('SELECT * FROM p4c_handoff WHERE dnb_id=$1 ORDER BY revision',[id])).rows;
 const handoff=handoffs.at(-1)??null;
 const transfers=handoff?(await db.query('SELECT * FROM p4c_handoff_transfer WHERE handoff_id=$1 ORDER BY sequence',[handoff.id])).rows:[];
 const verifications=handoff?(await db.query('SELECT v.* FROM p4c_handoff_verification v JOIN p4c_handoff_transfer t ON t.id=v.transfer_id WHERE t.handoff_id=$1 ORDER BY t.sequence',[handoff.id])).rows:[];
 const relevantEvents=events.filter(e=>!['PREVIEW','PRE_WORK','COMPLETED','RECALL'].includes(e.event_type));
 const evidenceHash=digest({dnb,pool,observations,decision,runs,qc4,handoffs,transfers,verifications,events:relevantEvents});
 return {dnb,pool,events,observations,decision,runs,run,qc4,handoffs,handoff,transfers,verifications,evidenceHash};
}
export async function issueF5(db:Queryable,user:Staff,input:unknown,deps:F5Deps,previewOnly=false){
 const d=issueSchema.parse(input);await context(db,user,d,'execution.record');const x=await inputs(db,d.dnbId);
 if(d.kind==='PRE_WORK'&&x.events.some(e=>e.event_type==='DNB_START'))throw new LabError('PRE_WORK_BEFORE_EXECUTION_ONLY',409);
 if(d.kind==='COMPLETED'){
  const qc3=x.observations.find(o=>o.field==='QC3'),verified=(await db.query<{ok:boolean}>('SELECT p4c_handoff_verified($1) ok',[d.dnbId])).rows[0].ok;
  if(!x.events.some(e=>e.event_type==='DNB_END')||!(await qc3Evidence(db,d.dnbId)).ready||x.decision?.decision!=='SyntheticReviewed'||x.decision.observation_id!==qc3?.id||!x.run||!x.events.some(e=>e.event_type==='SEQUENCE_END'&&e.payload.sequencingId===x.run!.id)||!verified||!(await qc4Evidence(db,d.dnbId,x.run.id)).ready)throw new LabError('F5_COMPLETION_EVIDENCE_INCOMPLETE',409);
 }
 if(!previewOnly&&(await db.query('SELECT 1 FROM p4c_document WHERE dnb_id=$1 AND kind=$2',[d.dnbId,d.kind])).rows.length)throw new LabError('DOCUMENT_ALREADY_ISSUED',409);
 if(!previewOnly&&!x.events.some(e=>e.event_type==='PREVIEW'&&e.actor_id===user.id&&e.payload.kind===d.kind&&e.payload.evidenceHash===x.evidenceHash))throw new LabError('CURRENT_PREVIEW_REQUIRED',409);
 const serial=x.dnb.attempt_number,at=new Date().toISOString(),name=(await db.query<{display_name:string}>('SELECT display_name FROM app_user WHERE id=$1',[user.id])).rows[0].display_name;
 const actual:Record<string,string>={'F5-01':JSON.stringify({preparation:x.dnb.preparation,createdBy:x.dnb.created_by,createdAt:x.dnb.created_at}),
  'F5-02':JSON.stringify({preclean:x.dnb.preparation.preclean}),'F5-03':JSON.stringify({method:'UNRESOLVED_OD32_WC05',execution:x.events.filter(e=>['DNB_START','DNB_END'].includes(e.event_type))}),
  'F5-04':JSON.stringify({loadingReagentPrepared:x.dnb.preparation.loadingReagentPrepared}),'F5-05':JSON.stringify(x.dnb.payload.qubit??{}),
  'F5-06':x.observations.filter(o=>o.field!=='QC3').map(o=>`${o.field}: ${o.value} ng/uL; source and reviewer below`).join('; '),
  'F5-07':JSON.stringify({qc3:qc3Value(x.observations),decision:x.decision,acceptance:'HOLD'}),
  'F5-08':'FS-12 source: 50/50/1/100 uL — execution confirmation not inferred',
  'F5-09':JSON.stringify(x.run?.record??{}),'F5-10':JSON.stringify({record:x.run?.record,events:x.events.filter(e=>['SEQUENCE_START','SEQUENCE_END'].includes(e.event_type))}),
  'F5-11':String(x.run?.record.diskSpaceGb??''),'F5-12':String(x.run?.record.pressureKpa??''),'F5-13':JSON.stringify(x.events.findLast(e=>e.event_type==='SEQUENCE_END')?.payload??{}),
  'F5-14':`${x.handoff?.id??'UNAVAILABLE'} revision ${x.handoff?.revision??0}; transfer and independent verification evidence below; vendorCompatible=false`,
  'F5-15':JSON.stringify({sequencingId:x.run?.record.sequencingId,cartridgeId:x.run?.record.cartridgeId,flowCellId:x.run?.record.flowCellId,idSource:x.run?.record.idSource}),
  'F5-16':`${x.qc4.length} immutable QC4 records; values/source/reviewer below; clinical acceptance HOLD`,
  'F5-17':JSON.stringify({wash:x.run?.record.wash,postWash:x.events.findLast(e=>e.event_type==='SEQUENCE_END')?.payload.postWash})};
 const planned:Record<string,string>={'F5-03':'วิธี DNB ยังไม่รับรอง — OD-32 / WC-05','F5-05':'FS-10 Buffer=(N+2)*199 uL; Dye=N+2 uL; WC-14','F5-07':'QC3 8–40 ng/uL เป็นค่าอ้างอิงที่ยังไม่รับรอง (OD-31)','F5-08':'FS-12 source loading mix 50/50/1/100 uL','F5-10':'DNBSEQ-G50 / recipe และ run configuration จากหลักฐาน','F5-14':'Q-P4 / Q-I8 / Mapping / Vendor dry-run pending','F5-16':'QC4 ไม่มี Auto-Pass','F5-17':'Wash expiry และเวลา DNB 4°C / 48h ตามหลักฐาน; นโยบาย OD-33 pending'};
 const doc:F5Document={form:'F5',synthetic:true,clinicalUsable:false,purpose:d.purpose,kind:d.kind,preview:previewOnly,templateVersion:'SYNTHETIC-F5-v1',fieldInventory:'SEED_UNVERIFIED',docId:randomUUID(),batchId:d.batchId,dnbId:d.dnbId,runLabel:x.pool.payload.runLabel,dnbLabel:x.dnb.dnb_label,revision:serial,issuedBy:name,issuedAt:at,poolSnapshotId:x.pool.id,poolHash:x.pool.sha256,evidenceHash:x.evidenceHash,holds:[...HOLDS],
  fields:F5_FIELDS.map(([id,label])=>({id,label,planned:planned[id]??'ช่องบันทึกหลักฐานในแบบจำลอง — ยังไม่รับรอง Field Inventory',actual:d.kind==='COMPLETED'?actual[id]??null:null})),
  members:x.pool.payload.members.map(m=>{const mapped=x.handoff?.payload.mappedMembers?.find(v=>v.physicalPosition===m.slot);return {position:m.slot,role:m.kind,printedId:m.printedSampleId??m.printedControlId??'',lnHalos:m.lnHalos??'',barcode:mapped?`${mapped.barcodeIndex} / ${mapped.barcodeType} SYNTHETIC UNVERIFIED`:'UNMAPPED — HOLD'};}),
  evidence:d.kind==='COMPLETED'?[...x.observations.map(o=>({fieldId:o.field==='QC3'?'F5-07':'F5-06',text:JSON.stringify(o)})),...x.qc4.map(o=>({fieldId:'F5-16',text:JSON.stringify(o)})),...x.transfers.map(o=>({fieldId:'F5-14',text:JSON.stringify(o)})),...x.verifications.flatMap(verificationEvidence)]:[],copy:null};
 const bytes=await deps.render(doc);
 if(previewOnly){await append(db,user,d.dnbId,'PREVIEW',{kind:d.kind,evidenceHash:x.evidenceHash,sha256:sha256(bytes)});return {bytes,version:await touch(db,d.batchId)};}
 const hash=await deps.store.put(bytes);await db.query('INSERT INTO p4c_document(id,dnb_id,kind,revision,snapshot,file_sha256,issued_by,issued_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[doc.docId,d.dnbId,d.kind,serial,JSON.stringify(doc),hash,user.id,at]);
 await append(db,user,d.dnbId,d.kind,{documentId:doc.docId,sha256:hash,evidenceHash:x.evidenceHash});return {id:doc.docId,sha256:hash,version:await touch(db,d.batchId)};
}
const qc3Value=(obs:Obs[])=>obs.find(o=>o.field==='QC3')?.value??null;
function verificationEvidence(v:Record<string,unknown>){const {observed,...metadata}=v,record=observed as {observedRows?:unknown[]};const {observedRows,...header}=record;return [{fieldId:'F5-14',text:JSON.stringify({...metadata,observed:header})},...(observedRows??[]).map((row,i)=>({fieldId:'F5-14',text:JSON.stringify({verificationId:v.id,row:i+1,observed:row,reviewer:v.reviewer_id})}))];}
async function docContext(db:Queryable,user:Staff,id:string){
 await assertSession(db,user);need(user,'worksheet.read','read');const doc=(await db.query<Doc>('SELECT * FROM p4c_document WHERE id=$1',[uuid.parse(id)])).rows[0];if(!doc)throw new LabError('NOT_FOUND',404);
 const row=(await db.query<{batch_id:string}>('SELECT batch_id FROM p4c_dnb_attempt WHERE id=$1',[doc.dnb_id])).rows[0];await db.query('SELECT id FROM lab_batch WHERE id=$1 FOR UPDATE',[row.batch_id]);const x=await inputs(db,doc.dnb_id);
 let invalidSource=false;try{await storedPool(db,x.dnb.batch_id,x.dnb.pool_snapshot_id);}catch{invalidSource=true;}
 const current=(await db.query<{ok:boolean}>('SELECT p4c_pool_current($1) ok',[doc.dnb_id])).rows[0].ok;
 return {doc,...x,inactive:!current||invalidSource};
}
export async function readF5(db:Queryable,user:Staff,id:string,deps:F5Deps){const x=await docContext(db,user,id);await audit(db,user,'F5_DOCUMENT_VIEWED','p4c_document',id,{outcome:x.inactive?'STOP_USE':'SYNTHETIC_HOLD'});return {bytes:await deps.store.get(x.doc.file_sha256),sha256:x.doc.file_sha256,status:x.inactive?'STOP_USE':'SYNTHETIC_HOLD'};}
export async function printF5(db:Queryable,user:Staff,input:unknown,deps:F5Deps){
 const d=z.strictObject({documentId:uuid,kind:z.enum(['ORIGINAL_REPRINT','WORKING_COPY','STATUS_MARKED']),reason:reasonText}).parse(input),x=await docContext(db,user,d.documentId);
 if(d.kind==='WORKING_COPY'){need(user,'execution.record');if(x.inactive||x.doc.kind!=='PRE_WORK'||x.events.some(e=>e.event_type==='COMPLETED'))throw new LabError('WORKING_COPY_NOT_USABLE',409);}
 if(d.kind==='ORIGINAL_REPRINT'&&x.inactive)need(user,'document.obsolete.print');if(d.kind==='STATUS_MARKED'&&!x.inactive)throw new LabError('STATUS_MARK_ONLY_FOR_INACTIVE',409);
 const n=(await db.query<{n:number}>('SELECT COALESCE(max(copy_number),0)+1 n FROM p4c_document_copy WHERE document_id=$1',[d.documentId])).rows[0].n;
 const bytes=d.kind==='ORIGINAL_REPRINT'?await deps.store.get(x.doc.file_sha256):await deps.render({...x.doc.snapshot,copy:{kind:d.kind,number:n,originalHash:x.doc.file_sha256,actor:user.id,at:new Date().toISOString(),status:x.inactive?'STOP_USE':'SYNTHETIC_HOLD',reason:d.reason}});
 const hash=await deps.store.put(bytes),copy=(await db.query<{id:string}>('INSERT INTO p4c_document_copy(document_id,copy_number,kind,file_sha256,derived_from,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[d.documentId,n,d.kind,hash,x.doc.file_sha256,d.reason,user.id])).rows[0];
 await audit(db,user,'F5_DOCUMENT_PRINTED','p4c_document_copy',copy.id,{outcome:d.kind,count:n});return {id:copy.id,sha256:hash,bytes,version:await touch(db,x.dnb.batch_id)};
}
