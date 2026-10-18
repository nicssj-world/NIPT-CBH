import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {recordPhiAccess} from '../db/phi-access';
import {authorize} from '../security/policy';
import {LabError,assertSession,audit,need,reasonText,uuid,caseVisible,type Staff} from '../lab/core';
import {isoDate} from '../domain/thai-date';
import {sniffImage,imageSize,safeOriginalName,type PhotoMediaType} from './image';
import {validateRootPath,defaultRoot,testPhotoRoot,PhotoStorageError,type StorageTest} from './store';

// Run Photo Evidence. FINAL OWNER LOCK: photos are optional supporting evidence. Nothing in this module is called by, or
// can block, Task List, QC, Pooling, Result or HIS work, and a Run without photos is a normal Run.

export const MAX_PHOTO_BYTES=()=>Math.min(50,Math.max(1,Number(process.env.RUN_PHOTO_MAX_MB)||30))*1024*1024;
export const MAX_THUMB_BYTES=512*1024;
export const MAX_THUMB_EDGE=1024;
const caption=z.string().max(1000).transform(v=>v.replace(/\r\n?/g,'\n').trim()).refine(v=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)&&!/\d{13}/.test(v),'CAPTION_TEXT_INVALID');
const sample=z.number().int().min(1).max(48);
const takenOn=isoDate;
const ranged=<T extends {sampleFrom:number|null;sampleTo:number|null}>(s:z.ZodType<T>)=>s.refine(v=>(v.sampleFrom===null)===(v.sampleTo===null),'SAMPLE_RANGE_INCOMPLETE').refine(v=>v.sampleFrom===null||v.sampleTo!>=v.sampleFrom,'SAMPLE_RANGE_ORDER');
export const uploadInput=ranged(z.strictObject({batchId:uuid,idempotencyKey:z.string().regex(/^[A-Za-z0-9_-]{16,80}$/),caption:caption.default(''),sampleFrom:sample.nullable().default(null),sampleTo:sample.nullable().default(null),takenOn}));
const editInput=ranged(z.strictObject({expectedRowVersion:z.number().int().min(1),caption,sampleFrom:sample.nullable(),sampleTo:sample.nullable(),takenOn}));

type Root={root_id:string;root_path:string;state:string;source:string};
type PhotoRow={id:string;batch_id:string;root_id:string;sha256:string;byte_size:string;media_type:PhotoMediaType;width:number|null;height:number|null;thumb_sha256:string|null;thumb_bytes:number|null;original_name:string;caption:string;sample_from:number|null;sample_to:number|null;taken_on:string;uploaded_by:string;uploaded_at:Date;state:string;retracted_by:string|null;retracted_at:Date|null;retract_reason:string|null;row_version:number};
const PHOTO_COLS="p.id,p.batch_id,p.root_id,p.sha256,p.byte_size::text,p.media_type,p.width,p.height,p.thumb_sha256,p.thumb_bytes,p.original_name,p.caption,p.sample_from,p.sample_to,p.taken_on::text,p.uploaded_by,p.uploaded_at,p.state,p.retracted_by,p.retracted_at,p.retract_reason,p.row_version";
const BKK_TODAY="(now() AT TIME ZONE 'Asia/Bangkok')::date";
/** Placement of patient samples in a Run, numbered 1..n in slot order without controls (controls are never assigned). A
 * cancelled Run keeps the placement it had when it was cancelled. */
const PLACEMENT=`SELECT sa.batch_id,sa.slot_number,sa.attempt_id,row_number() OVER(PARTITION BY sa.batch_id ORDER BY sa.slot_number)::int ordinal
 FROM lab_slot_assignment sa WHERE sa.removed_at IS NULL OR sa.removed_reason='BATCH_CANCELLED'`;

// ── Storage roots ────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function activeRoot(db:Queryable):Promise<Root|null>{
 return (await db.query<Root>("SELECT root_id,root_path,state,source FROM run_photo_root_current WHERE state='Active'")).rows[0]??null;
}
export async function rootById(db:Queryable,id:string):Promise<Root|null>{
 return (await db.query<Root>('SELECT root_id,root_path,state,source FROM run_photo_root_current WHERE root_id=$1',[id])).rows[0]??null;
}
/** The root new photos go to. Until an administrator chooses one, the installation default folder is tested and recorded. */
export async function uploadRoot(db:Queryable):Promise<Root>{
 const current=await activeRoot(db);if(current)return current;
 const root=defaultRoot(),receipt=await testPhotoRoot(root,{create:true});
 if(!receipt.ok)throw new LabError('STORAGE_UNAVAILABLE',503);
 await db.query('SELECT pg_advisory_xact_lock(75432840)');
 const again=await activeRoot(db);if(again)return again;
 const id=(await db.query<{id:string}>("INSERT INTO run_photo_storage_root(state,source,reason) VALUES('Active','INSTALLATION_DEFAULT','INSTALLATION_DEFAULT_ROOT') RETURNING id")).rows[0].id;
 await db.query("INSERT INTO run_photo_root_location(root_id,root_path,kind,test_receipt,reason) VALUES($1,$2,'INITIAL',$3,'INSTALLATION_DEFAULT_ROOT')",[id,root,JSON.stringify(receipt)]);
 return {root_id:id,root_path:root,state:'Active',source:'INSTALLATION_DEFAULT'};
}
const canConfigure=(user:Staff)=>authorize(user,'photo.storage.configure',{},'write');
/** Storage status for Settings. The absolute path is shown only to those who may change it. */
export async function storageOverview(db:Queryable,user:Staff){
 await assertSession(db,user);
 if(!canConfigure(user)&&!authorize(user,'settings.read',{},'read'))throw new LabError('FORBIDDEN',403);
 const show=canConfigure(user);
 const roots=(await db.query<{root_id:string;state:string;source:string;root_path:string;created_at:Date;retired_at:Date|null;created_by:string|null;photos:number;bytes:string;receipt:StorageTest}>(
  `SELECT c.root_id,c.state,c.source,c.root_path,r.created_at,r.retired_at,u.display_name created_by,
   (SELECT count(*) FROM run_photo p WHERE p.root_id=c.root_id)::int photos,(SELECT COALESCE(sum(p.byte_size+COALESCE(p.thumb_bytes,0)),0) FROM run_photo p WHERE p.root_id=c.root_id)::text bytes,
   (SELECT l.test_receipt FROM run_photo_root_location l WHERE l.root_id=c.root_id ORDER BY l.sequence DESC LIMIT 1) receipt
   FROM run_photo_root_current c JOIN run_photo_storage_root r ON r.id=c.root_id LEFT JOIN app_user u ON u.id=r.created_by ORDER BY r.created_at DESC`)).rows;
 return {canConfigure:show,defaultInUse:!roots.some(r=>r.state==='Active'),
  roots:roots.map(r=>({id:r.root_id,state:r.state,source:r.source,path:show?r.root_path:null,createdAt:r.created_at,retiredAt:r.retired_at,createdBy:r.created_by,photos:r.photos,bytes:Number(r.bytes),
   lastTest:{ok:r.receipt.ok,testedAt:r.receipt.testedAt,account:show?r.receipt.account:null,freeBytes:r.receipt.freeBytes}}))};
}
/** Administrator test of a candidate path, run by the web process — the same account that stores the photos. */
export async function testStoragePath(user:Staff,input:unknown){
 need(user,'photo.storage.configure');
 const {path:raw}=z.strictObject({path:z.string().max(400)}).parse(input);
 let root:string;try{root=validateRootPath(raw);}catch(e){if(e instanceof PhotoStorageError)throw new LabError(e.code,422);throw e;}
 return {path:root,receipt:await testPhotoRoot(root)};
}
/** New photos go to the new path from now on. The previous root is retired, not moved or deleted: its photos stay readable. */
export async function activateStoragePath(db:Queryable,user:Staff,input:unknown,tested:{path:string;receipt:StorageTest}){
 await assertSession(db,user);need(user,'photo.storage.configure');
 const d=z.strictObject({path:z.string().max(400),reason:reasonText}).parse(input);
 if(validateRootPath(d.path)!==tested.path)throw new LabError('STORAGE_TEST_PATH_MISMATCH',409);
 if(!tested.receipt.ok)throw new LabError('STORAGE_TEST_FAILED',422,{checks:tested.receipt.checks});
 await db.query('SELECT pg_advisory_xact_lock(75432840)');
 const current=await activeRoot(db);
 const fold=(p:string)=>process.platform==='win32'?p.toLowerCase():p;
 if(current&&fold(current.root_path)===fold(tested.path))throw new LabError('STORAGE_PATH_UNCHANGED',409);
 if(current){await db.query("UPDATE run_photo_storage_root SET state='Retired',retired_by=$2,retired_at=now() WHERE id=$1",[current.root_id,user.id]);await audit(db,user,'RUN_PHOTO_STORAGE_RETIRED','run_photo_storage_root',current.root_id,{outcome:'RETIRED'});}
 const id=(await db.query<{id:string}>("INSERT INTO run_photo_storage_root(state,source,reason,created_by) VALUES('Active','ADMIN',$1,$2) RETURNING id",[d.reason,user.id])).rows[0].id;
 await db.query("INSERT INTO run_photo_root_location(root_id,root_path,kind,test_receipt,reason,actor_id) VALUES($1,$2,'INITIAL',$3,$4,$5)",[id,tested.path,JSON.stringify(tested.receipt),d.reason,user.id]);
 await audit(db,user,'RUN_PHOTO_STORAGE_ACTIVATED','run_photo_storage_root',id,{outcome:'ACTIVE',count:current?1:0});
 return {rootId:id,retiredRootId:current?.root_id??null};
}

// ── Upload ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type PreparedPhoto={input:z.infer<typeof uploadInput>;bytes:Buffer;mediaType:PhotoMediaType;name:string;size:{width:number;height:number}|null;thumb:Buffer|null};
/** Validates one file before anything is written. The thumbnail (made by the uploading browser) is optional. */
export function preparePhoto(raw:unknown,file:{name:string;bytes:Buffer},thumb:Buffer|null):PreparedPhoto{
 const input=uploadInput.parse(raw);
 if(!file.bytes.length)throw new LabError('EMPTY_FILE',422);
 if(file.bytes.length>MAX_PHOTO_BYTES())throw new LabError('FILE_TOO_LARGE',413);
 const mediaType=sniffImage(file.bytes);if(!mediaType)throw new LabError('UNSUPPORTED_IMAGE',415);
 let t:Buffer|null=null;
 if(thumb?.length){const tt=sniffImage(thumb);const ts=tt&&imageSize(thumb,tt);
  if(thumb.length>MAX_THUMB_BYTES||!tt||!['image/jpeg','image/webp','image/png'].includes(tt)||!ts||ts.width>MAX_THUMB_EDGE||ts.height>MAX_THUMB_EDGE)throw new LabError('THUMBNAIL_INVALID',422);t=thumb;}
 return {input,bytes:file.bytes,mediaType,name:safeOriginalName(file.name,mediaType),size:imageSize(file.bytes,mediaType),thumb:t};
}
async function runRow(db:Queryable,batchId:string,lock=false){
 const b=(await db.query<{id:string;run_label:string;state:string}>(`SELECT id,run_label,state FROM lab_batch WHERE id=$1${lock?' FOR SHARE':''}`,[batchId])).rows[0];
 if(!b)throw new LabError('NOT_FOUND',404);return b;
}
/** Records a photo whose bytes are already stored (and verified) under `root`. Runs inside the caller's transaction. */
export async function recordPhoto(db:Queryable,user:Staff,p:PreparedPhoto,stored:{root:Root;sha256:string;thumbSha256:string|null}){
 await assertSession(db,user);need(user,'photo.upload');
 const today=(await db.query<{d:string}>(`SELECT ${BKK_TODAY}::text d`)).rows[0].d;
 if(p.input.takenOn>today)throw new LabError('TAKEN_ON_FUTURE',422);
 if(p.input.takenOn<'2020-01-01')throw new LabError('TAKEN_ON_TOO_OLD',422);
 const run=await runRow(db,p.input.batchId,true);
 const replay=(await db.query<{id:string;batch_id:string;sha256:string}>('SELECT id,batch_id,sha256 FROM run_photo WHERE idempotency_key=$1',[p.input.idempotencyKey])).rows[0];
 if(replay){if(replay.batch_id!==run.id||replay.sha256!==stored.sha256)throw new LabError('IDEMPOTENCY_KEY_REUSED',409);return {photoId:replay.id,replayed:true,otherRuns:[] as string[]};}
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['run_photo:'+run.id+':'+stored.sha256]);
 const same=(await db.query<{id:string}>("SELECT id FROM run_photo WHERE batch_id=$1 AND sha256=$2 AND state='Active'",[run.id,stored.sha256])).rows[0];
 if(same)throw new LabError('DUPLICATE_IN_RUN',409,{photoId:same.id});
 // The same bytes filed in another Run is usually a wrong-Run upload: accepted, but the uploader is told where else it is.
 const otherRuns=(await db.query<{run_label:string}>("SELECT DISTINCT b.run_label FROM run_photo p JOIN lab_batch b ON b.id=p.batch_id WHERE p.sha256=$1 AND p.state='Active' AND p.batch_id<>$2 ORDER BY 1",[stored.sha256,run.id])).rows.map(r=>r.run_label);
 const id=(await db.query<{id:string}>(`INSERT INTO run_photo(batch_id,root_id,sha256,byte_size,media_type,width,height,thumb_sha256,thumb_bytes,original_name,caption,sample_from,sample_to,taken_on,uploaded_by,idempotency_key)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,[run.id,stored.root.root_id,stored.sha256,p.bytes.length,p.mediaType,p.size?.width??null,p.size?.height??null,stored.thumbSha256,stored.thumbSha256?p.thumb!.length:null,
   p.name,p.input.caption,p.input.sampleFrom,p.input.sampleTo,p.input.takenOn,user.id,p.input.idempotencyKey])).rows[0].id;
 await db.query("INSERT INTO run_photo_event(photo_id,event_type,actor_id,after) VALUES($1,'UPLOADED',$2,$3)",[id,user.id,JSON.stringify({batchId:run.id,runLabel:run.run_label,sha256:stored.sha256,caption:p.input.caption,sampleFrom:p.input.sampleFrom,sampleTo:p.input.sampleTo,takenOn:p.input.takenOn})]);
 await audit(db,user,'RUN_PHOTO_UPLOADED','run_photo',id,{outcome:otherRuns.length?'UPLOADED_ALSO_IN_OTHER_RUN':'UPLOADED',count:1});
 return {photoId:id,replayed:false,otherRuns};
}

// ── Corrections ──────────────────────────────────────────────────────────────────────────────────────────────────────────
async function lockedPhoto(db:Queryable,id:string){
 const p=(await db.query<PhotoRow>(`SELECT ${PHOTO_COLS} FROM run_photo p WHERE p.id=$1 FOR UPDATE`,[uuid.parse(id)])).rows[0];
 if(!p)throw new LabError('NOT_FOUND',404);return p;
}
/** LAB_STAFF correct their own uploads; a LAB_CERTIFIER may correct any upload. */
export const mayManage=(user:Staff,p:{uploaded_by:string})=>authorize(user,'photo.manage',{},'write')&&(p.uploaded_by===user.id||user.roles.includes('LAB_CERTIFIER'));
function manageable(user:Staff,p:PhotoRow,expected:number){
 if(!mayManage(user,p))throw new LabError('FORBIDDEN',403);
 if(p.state!=='Active')throw new LabError('RUN_PHOTO_RETRACTED',409);
 if(p.row_version!==expected)throw new LabError('VERSION_CONFLICT',409);
}
const snapshot=(p:Pick<PhotoRow,'caption'|'sample_from'|'sample_to'|'taken_on'>)=>({caption:p.caption,sampleFrom:p.sample_from,sampleTo:p.sample_to,takenOn:p.taken_on});
export async function editPhoto(db:Queryable,user:Staff,id:string,input:unknown){
 await assertSession(db,user);
 const d=editInput.parse(input);
 const p=await lockedPhoto(db,id);manageable(user,p,d.expectedRowVersion);
 const today=(await db.query<{d:string}>(`SELECT ${BKK_TODAY}::text d`)).rows[0].d;if(d.takenOn>today)throw new LabError('TAKEN_ON_FUTURE',422);
 const after={caption:d.caption,sampleFrom:d.sampleFrom,sampleTo:d.sampleTo,takenOn:d.takenOn};
 if(JSON.stringify(after)===JSON.stringify(snapshot(p)))return {photoId:p.id,rowVersion:p.row_version,changed:false};
 await db.query('UPDATE run_photo SET caption=$2,sample_from=$3,sample_to=$4,taken_on=$5,row_version=row_version+1 WHERE id=$1',[p.id,d.caption,d.sampleFrom,d.sampleTo,d.takenOn]);
 await db.query("INSERT INTO run_photo_event(photo_id,event_type,actor_id,before,after) VALUES($1,'EDITED',$2,$3,$4)",[p.id,user.id,JSON.stringify(snapshot(p)),JSON.stringify(after)]);
 await audit(db,user,'RUN_PHOTO_EDITED','run_photo',p.id,{outcome:'EDITED',version:p.row_version+1});
 return {photoId:p.id,rowVersion:p.row_version+1,changed:true};
}
/** Wrong-Run association: the photo is re-filed under the correct Run with a reason; the move stays in history. */
export async function movePhoto(db:Queryable,user:Staff,id:string,input:unknown){
 await assertSession(db,user);
 const d=z.strictObject({expectedRowVersion:z.number().int().min(1),targetBatchId:uuid,reason:reasonText}).parse(input);
 const p=await lockedPhoto(db,id);manageable(user,p,d.expectedRowVersion);
 if(d.targetBatchId===p.batch_id)throw new LabError('RUN_PHOTO_SAME_RUN',409);
 const [from,to]=[await runRow(db,p.batch_id),await runRow(db,d.targetBatchId,true)];
 const dup=(await db.query<{id:string}>("SELECT id FROM run_photo WHERE batch_id=$1 AND sha256=$2 AND state='Active'",[to.id,p.sha256])).rows[0];
 if(dup)throw new LabError('DUPLICATE_IN_RUN',409,{photoId:dup.id});
 await db.query('UPDATE run_photo SET batch_id=$2,row_version=row_version+1 WHERE id=$1',[p.id,to.id]);
 await db.query("INSERT INTO run_photo_event(photo_id,event_type,actor_id,reason,before,after) VALUES($1,'MOVED',$2,$3,$4,$5)",[p.id,user.id,d.reason,JSON.stringify({batchId:from.id,runLabel:from.run_label}),JSON.stringify({batchId:to.id,runLabel:to.run_label})]);
 await audit(db,user,'RUN_PHOTO_MOVED','run_photo',p.id,{outcome:'MOVED',version:p.row_version+1});
 return {photoId:p.id,rowVersion:p.row_version+1,batchId:to.id,runLabel:to.run_label};
}
/** A wrong or unusable upload is retracted with a reason. The file and its record are kept for audit; nothing is deleted. */
export async function retractPhoto(db:Queryable,user:Staff,id:string,input:unknown){
 await assertSession(db,user);
 const d=z.strictObject({expectedRowVersion:z.number().int().min(1),reason:reasonText}).parse(input);
 const p=await lockedPhoto(db,id);manageable(user,p,d.expectedRowVersion);
 await db.query("UPDATE run_photo SET state='Retracted',retracted_by=$2,retracted_at=now(),retract_reason=$3,row_version=row_version+1 WHERE id=$1",[p.id,user.id,d.reason]);
 await db.query("INSERT INTO run_photo_event(photo_id,event_type,actor_id,reason,before,after) VALUES($1,'RETRACTED',$2,$3,$4,$5)",[p.id,user.id,d.reason,JSON.stringify({state:'Active'}),JSON.stringify({state:'Retracted'})]);
 await audit(db,user,'RUN_PHOTO_RETRACTED','run_photo',p.id,{outcome:'RETRACTED',version:p.row_version+1});
 return {photoId:p.id,rowVersion:p.row_version+1};
}

// ── Reading ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
type PhotoView=ReturnType<typeof photoView>;
function photoView(p:PhotoRow&{uploader:string;retractor:string|null},user:Staff){
 return {id:p.id,batchId:p.batch_id,mediaType:p.media_type,bytes:Number(p.byte_size),width:p.width,height:p.height,hasThumb:!!p.thumb_sha256,sha256:p.sha256,name:p.original_name,
  caption:p.caption,sampleFrom:p.sample_from,sampleTo:p.sample_to,takenOn:p.taken_on,uploadedBy:p.uploader,uploadedAt:p.uploaded_at,state:p.state as 'Active'|'Retracted',
  retractedBy:p.retractor,retractedAt:p.retracted_at,retractReason:p.retract_reason,rowVersion:p.row_version,canManage:p.state==='Active'&&mayManage(user,p)};
}
const PHOTO_FROM=`FROM run_photo p JOIN app_user u ON u.id=p.uploaded_by LEFT JOIN app_user x ON x.id=p.retracted_by`;
type PlacementRow={slot_number:number;ordinal:number;attempt_id:string;ln:string;ln_halos:string|null;printed_sample_id:string|null;round_number:number;unit_id:string|null;registration_origin:string};
async function placementOf(db:Queryable,batchId:string){
 return (await db.query<PlacementRow>(`SELECT pl.slot_number,pl.ordinal,pl.attempt_id,l.ln,n.ln_halos,a.printed_sample_id,r.round_number,c.registration_origin,
  (SELECT s.unit_id FROM case_unit_scope s WHERE s.case_id=c.id ORDER BY s.unit_id LIMIT 1) unit_id
  FROM (${PLACEMENT}) pl JOIN analytical_attempt a ON a.id=pl.attempt_id JOIN specimen_round r ON r.id=a.round_id JOIN nipt_case c ON c.id=a.case_id JOIN case_ln l ON l.id=r.case_ln_id
  LEFT JOIN specimen_lab_number n ON n.round_id=r.id WHERE pl.batch_id=$1 ORDER BY pl.ordinal`,[batchId])).rows;
}
/** Gallery of one Run: photos grouped by the date they were taken, and the sample order used by declared ranges. */
export async function runGallery(db:Queryable,user:Staff,batchId:string,options:{includeRetracted?:boolean}={}){
 await assertSession(db,user);need(user,'photo.read','read');
 const b=(await db.query<{id:string;run_label:string;state:string;created_at:Date;sheet_states:string[];work_dates:string[]}>(`SELECT b.id,b.run_label,b.state,b.created_at,
  ARRAY(SELECT t.state FROM lab_task_sheet t WHERE t.batch_id=b.id ORDER BY t.sheet_number) sheet_states,
  ARRAY(SELECT DISTINCT t.planned_work_date::text FROM lab_task_sheet t WHERE t.batch_id=b.id AND t.planned_work_date IS NOT NULL ORDER BY 1) work_dates FROM lab_batch b WHERE b.id=$1`,[uuid.parse(batchId)])).rows[0];
 if(!b)throw new LabError('NOT_FOUND',404);
 const photos=(await db.query<PhotoRow&{uploader:string;retractor:string|null}>(`SELECT ${PHOTO_COLS},u.display_name uploader,x.display_name retractor ${PHOTO_FROM}
  WHERE p.batch_id=$1 AND (p.state='Active' OR $2) ORDER BY p.taken_on DESC,p.uploaded_at DESC`,[b.id,options.includeRetracted===true])).rows.map(p=>photoView(p,user));
 const retracted=(await db.query<{n:number}>("SELECT count(*)::int n FROM run_photo WHERE batch_id=$1 AND state='Retracted'",[b.id])).rows[0].n;
 const placement=(await placementOf(db,b.id)).map(r=>({ordinal:r.ordinal,slot:r.slot_number,...(caseVisible(user,r)?{sampleCode:r.printed_sample_id??r.ln_halos,lnHis:r.ln,lnHalos:r.ln_halos,round:r.round_number}:{sampleCode:null,lnHis:null,lnHalos:null,round:null})}));
 const editable=b.sheet_states.some(s=>['Draft','PlanChecked','Amended'].includes(s));
 return {run:{id:b.id,runLabel:b.run_label,state:b.state,createdAt:b.created_at,workDates:b.work_dates,placementEditable:editable&&b.state!=='Cancelled'},photos,retracted,placement,
  can:{upload:authorize(user,'photo.upload'),manage:authorize(user,'photo.manage')},history:await photoHistory(db,b.id)};
}
async function photoHistory(db:Queryable,batchId:string){
 return (await db.query<{photo_id:string;event_type:string;reason:string|null;before:unknown;after:unknown;created_at:Date;actor:string}>(`SELECT e.photo_id,e.event_type,e.reason,e.before,e.after,e.created_at,u.display_name actor FROM run_photo_event e JOIN app_user u ON u.id=e.actor_id
  WHERE e.photo_id IN (SELECT id FROM run_photo WHERE batch_id=$1) OR (e.event_type='MOVED' AND e.before->>'batchId'=$1::text) ORDER BY e.sequence DESC LIMIT 200`,[batchId])).rows
  .map(e=>({photoId:e.photo_id,type:e.event_type,reason:e.reason,before:e.before,after:e.after,at:e.created_at,actor:e.actor}));
}
/** Photo counts for Run lists and the Run page entry point (read only, never a requirement). */
export async function photoCounts(db:Queryable,batchIds:readonly string[]){
 if(!batchIds.length)return {} as Record<string,number>;
 const rows=(await db.query<{batch_id:string;n:number}>("SELECT batch_id,count(*)::int n FROM run_photo WHERE batch_id=ANY($1::uuid[]) AND state='Active' GROUP BY batch_id",[batchIds])).rows;
 return Object.fromEntries(rows.map(r=>[r.batch_id,r.n])) as Record<string,number>;
}
/** File lookup for the authenticated photo endpoint. Viewing an original (which may show patient labels) is audited. */
export async function photoForServing(db:Queryable,user:Staff,id:string,variant:'thumb'|'original'){
 await assertSession(db,user);need(user,'photo.read','read');
 const p=(await db.query<{id:string;root_id:string;sha256:string;thumb_sha256:string|null;media_type:PhotoMediaType;state:string}>('SELECT id,root_id,sha256,thumb_sha256,media_type,state FROM run_photo WHERE id=$1',[uuid.parse(id)])).rows[0];
 if(!p)throw new LabError('NOT_FOUND',404);
 const root=await rootById(db,p.root_id);if(!root)throw new LabError('NOT_FOUND',404);
 if(variant==='thumb'&&!p.thumb_sha256)throw new LabError('THUMBNAIL_MISSING',404);
 if(variant==='original')await audit(db,user,'RUN_PHOTO_VIEWED','run_photo',p.id,{outcome:p.state==='Active'?'ORIGINAL':'ORIGINAL_RETRACTED'});
 return {rootPath:root.root_path,hash:variant==='thumb'?p.thumb_sha256!:p.sha256,mediaType:variant==='thumb'?null:p.media_type,id:p.id};
}

// ── Search ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const searchInput=z.strictObject({date:isoDate.nullish(),run:z.string().trim().max(20).nullish(),lnHalos:z.string().trim().max(20).nullish(),lnHis:z.string().trim().max(20).nullish(),
 sample:z.number().int().min(1).max(48).nullish(),text:z.string().trim().max(100).nullish(),includeRetracted:z.boolean().default(false),
 /** Runs already shown; "load more" asks for the next block of Runs with the same criteria. */runsOffset:z.number().int().min(0).max(1000000).default(0)});
/** Photos returned by one search. The rest stay reachable from each Run's own page, and the response says when this cap was reached. */
export const SEARCH_PHOTO_CAP=300;
/** "12", "Run012", "012/2026", "Run012/2026" → run number (and year). */
export function parseRunQuery(q:string){
 const m=/^(?:run\s*)?0*(\d{1,4})(?:\s*\/\s*(\d{4}))?$/i.exec(q.trim());
 if(!m)throw new LabError('RUN_QUERY_INVALID',422);
 return {number:Number(m[1]),year:m[2]?Number(m[2]):null};
}
const like=(s:string)=>'%'+s.replace(/[\\%_]/g,c=>'\\'+c)+'%';
/**
 * Search by Run date, Run number, LN Halos, LN HIS, sample order and caption text. An LN search returns the Runs the sample was
 * placed in (from the actual slot assignments) and their photos. A photo is said to cover the sample only when its uploader
 * declared a sample range that includes the sample's order; otherwise it is just a photo of that Run.
 */
export async function searchRunPhotos(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'photo.read','read');
 const d=searchInput.parse(input);
 const lnHalos=d.lnHalos?d.lnHalos.toUpperCase():null,lnHis=d.lnHis||null;
 if(lnHalos&&!/^[0-9]{2}B[0-9]{9}(D?(-[12]|R)?|D)?$/.test(lnHalos))throw new LabError('LN_HALOS_QUERY_INVALID',422);
 if(lnHis&&!/^[0-9]{1,20}$/.test(lnHis))throw new LabError('LN_HIS_QUERY_INVALID',422);
 const run=d.run?parseRunQuery(d.run):null;
 const criteria=!!(d.date||run||lnHalos||lnHis||d.sample||d.text);

 // 1. Samples matching an LN, with every Run they were ever placed in (current placement gives the order).
 type Match={batch_id:string;run_label:string;slot_number:number;ordinal:number|null;removed:boolean;case_id:string;ln:string;ln_halos:string|null;printed_sample_id:string|null;round_number:number;unit_id:string|null;registration_origin:string};
 let matches:Match[]=[];
 if(lnHalos||lnHis){
  const base=lnHalos?lnHalos.slice(0,12):null;
  matches=(await db.query<Match>(`SELECT DISTINCT ON(sa.batch_id,sa.attempt_id) sa.batch_id,b.run_label,sa.slot_number,pl.ordinal,(pl.attempt_id IS NULL) removed,a.case_id,l.ln,n.ln_halos,a.printed_sample_id,r.round_number,c.registration_origin,
   (SELECT s.unit_id FROM case_unit_scope s WHERE s.case_id=c.id ORDER BY s.unit_id LIMIT 1) unit_id
   FROM lab_slot_assignment sa JOIN lab_batch b ON b.id=sa.batch_id JOIN analytical_attempt a ON a.id=sa.attempt_id JOIN specimen_round r ON r.id=a.round_id JOIN nipt_case c ON c.id=a.case_id JOIN case_ln l ON l.id=r.case_ln_id
   LEFT JOIN specimen_lab_number n ON n.round_id=r.id LEFT JOIN (${PLACEMENT}) pl ON pl.batch_id=sa.batch_id AND pl.attempt_id=sa.attempt_id
   WHERE ($1::text IS NULL OR l.ln=$1) AND ($2::text IS NULL OR n.ln_halos=$2 OR a.printed_sample_id=$3)
   ORDER BY sa.batch_id,sa.attempt_id,(pl.attempt_id IS NULL),sa.assigned_at DESC LIMIT 200`,[lnHis,base,lnHalos])).rows.filter(m=>caseVisible(user,m));
  if(matches.length)await recordPhiAccess(db,user.id,matches.map(m=>m.case_id),'REGISTRY_VIEW');
 }
 const lnRuns=(lnHalos||lnHis)?[...new Set(matches.map(m=>m.batch_id))]:null;

 // 2. Runs (Run-level criteria) and photos (photo-level criteria). Each query numbers its own parameters.
 const sql=()=>{const values:unknown[]=[];return {values,v:(x:unknown)=>{values.push(x);return '$'+values.length;}};};
 const runLevel=(q:ReturnType<typeof sql>)=>{const w:string[]=[];
  if(run){w.push(`b.run_number=${q.v(run.number)}`);if(run.year)w.push(`b.run_year=${q.v(run.year)}`);}
  if(lnRuns)w.push(`b.id=ANY(${q.v(lnRuns)}::uuid[])`);return w;};
 const runDate=(q:ReturnType<typeof sql>)=>{const x=q.v(d.date);return `((b.created_at AT TIME ZONE 'Asia/Bangkok')::date=${x}::date OR EXISTS(SELECT 1 FROM lab_task_sheet t WHERE t.batch_id=b.id AND (t.planned_work_date=${x}::date OR (t.execution_started_at AT TIME ZONE 'Asia/Bangkok')::date=${x}::date)))`;};
 // One predicate for the photo list, the photo count and the choice of Runs, so the three always agree. ESCAPE is a single backslash
 // (the template needs '\\'): the previous '\' collapsed to an empty escape string, so a caption search for "%" or "_" never matched.
 const photoPredicate=(q:ReturnType<typeof sql>)=>{const w=[...runLevel(q),`(p.state='Active' OR ${q.v(d.includeRetracted)}::boolean)`];
  if(d.date)w.push(`(p.taken_on=${q.v(d.date)}::date OR ${runDate(q)})`);
  if(d.sample){const n=q.v(d.sample);w.push(`p.sample_from<=${n}::int AND p.sample_to>=${n}::int`);}
  if(d.text)w.push(`p.caption ILIKE ${q.v(like(d.text))} ESCAPE '\\'`);
  return w;};
 const pq=sql(),photoWhere=photoPredicate(pq);
 const photoRows=criteria?(await db.query<PhotoRow&{uploader:string;retractor:string|null;run_label:string}>(`SELECT ${PHOTO_COLS},u.display_name uploader,x.display_name retractor,b.run_label ${PHOTO_FROM} JOIN lab_batch b ON b.id=p.batch_id
  WHERE ${photoWhere.join(' AND ')} ORDER BY p.taken_on DESC,p.uploaded_at DESC,p.id DESC LIMIT ${SEARCH_PHOTO_CAP+1}`,pq.values)).rows:[];
 const photosTruncated=photoRows.length>SEARCH_PHOTO_CAP,photos=photoRows.slice(0,SEARCH_PHOTO_CAP);
 const photoTotal=!criteria?0:photosTruncated?Number((await db.query<{n:string}>(`SELECT count(*)::text n ${PHOTO_FROM} JOIN lab_batch b ON b.id=p.batch_id WHERE ${photoWhere.join(' AND ')}`,pq.values)).rows[0].n):photos.length;
 // Runs meeting the Run criteria (for a date: the Run date or a photo taken that day); with only photo criteria, every Run that has a matching
 // photo - chosen by the predicate itself, not from the (capped) list of photos above, so a Run is never missed because of the cap.
 const rq=sql();let runWhere:string;
 const withPhotos=()=>`b.id IN (SELECT p.batch_id FROM run_photo p JOIN lab_batch b ON b.id=p.batch_id WHERE ${photoPredicate(rq).join(' AND ')})`;
 if(!criteria)runWhere='true';
 else if(!run&&!lnRuns&&!d.date)runWhere=withPhotos();
 else{const w=runLevel(rq);if(d.date)w.push(`(${runDate(rq)} OR EXISTS(SELECT 1 FROM run_photo q WHERE q.batch_id=b.id AND q.taken_on=${rq.v(d.date)}::date))`);
  if(d.sample||d.text)w.push(withPhotos());runWhere=w.join(' AND ');}
 const runBlock=criteria?200:60;
 const runTotal=Number((await db.query<{n:string}>(`SELECT count(*)::text n FROM lab_batch b WHERE ${runWhere}`,rq.values)).rows[0].n);
 const runs=(await db.query<{id:string;run_label:string;state:string;created_at:Date;work_dates:string[];photos:number;latest:string|null}>(`SELECT b.id,b.run_label,b.state,b.created_at,
  ARRAY(SELECT DISTINCT t.planned_work_date::text FROM lab_task_sheet t WHERE t.batch_id=b.id AND t.planned_work_date IS NOT NULL ORDER BY 1) work_dates,
  (SELECT count(*) FROM run_photo q WHERE q.batch_id=b.id AND q.state='Active')::int photos,(SELECT max(q.taken_on)::text FROM run_photo q WHERE q.batch_id=b.id AND q.state='Active') latest
  FROM lab_batch b WHERE ${runWhere} ORDER BY b.created_at DESC,b.id DESC LIMIT ${runBlock} OFFSET ${d.runsOffset}`,rq.values)).rows;
 const byRun=new Map<string,Match[]>();for(const m of matches){if(!byRun.has(m.batch_id))byRun.set(m.batch_id,[]);byRun.get(m.batch_id)!.push(m);}
 const nextRunsOffset=d.runsOffset+runs.length;
 return {criteria,
  /** Exact totals (never the capped list lengths): Runs matching, photos matching, and whether the photo list hit its cap. */
  runTotal,hasMoreRuns:nextRunsOffset<runTotal,nextRunsOffset,photoTotal,photosTruncated,photoCap:SEARCH_PHOTO_CAP,
  runs:runs.map(r=>({id:r.id,runLabel:r.run_label,state:r.state,createdAt:r.created_at,workDates:r.work_dates,photos:r.photos,latestTakenOn:r.latest})),
  lnMatches:matches.map(m=>({batchId:m.batch_id,runLabel:m.run_label,slot:m.slot_number,ordinal:m.ordinal,removed:m.removed,sampleCode:m.printed_sample_id??m.ln_halos,lnHis:m.ln,lnHalos:m.ln_halos,round:m.round_number})),
  photos:photos.map(x=>{const own=byRun.get(x.batch_id)??[];
   const covers=own.filter(m=>m.ordinal!==null&&x.sample_from!==null&&m.ordinal>=x.sample_from&&m.ordinal<=x.sample_to!).map(m=>m.ordinal!);
   return {...photoView(x,user),runLabel:x.run_label,coversLnOrdinals:lnRuns?covers:null};}),
  lnSearched:!!lnRuns};
}
export type RunGallery=Awaited<ReturnType<typeof runGallery>>;
export type PhotoSearch=Awaited<ReturnType<typeof searchRunPhotos>>;
export type {PhotoView};
