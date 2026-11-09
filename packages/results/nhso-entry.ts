import {z} from 'zod';
import type {Queryable} from '../db/connection';
import type {FileStore} from '../storage';
import {assertSession,need,caseVisible,audit,uuid,LabError,type Staff} from '../lab/core';
import {entitlementKind} from '../forms/request-contract';
import {parsePet} from '../integrations/pet';
import {ageOnDate,calculations,type RequestDraft} from '../p2/schema';
import {bangkokIsoDay} from '../domain/thai-date';
import {gaParts} from './nhso-format';
import {recordPhiAccess} from '../db/phi-access';

// ลงผลสปสช. (Owner 2026-11-09). Lists every certified, Active result of a patient whose request records the NHSO (สปสช.) entitlement;
// staff copy the patient data into the NHSO system and confirm here. The state is the latest nhso_result_entry_event of that release
// (migration 208). A reissued result is a new release, so it comes back as pending with `reissued` set.
export type NhsoTab='PENDING'|'DONE';
export type NhsoRow={releaseId:string;caseId:string;ln:string;hn:string|null;name:string|null;certifiedAt:string;reissued:boolean;entry:{at:string;by:string|null}|null};

type R={release_id:string;case_id:string;round_id:string;certified_at:Date;ln:string;hn:string|null;name:string|null;registration_origin:string;unit_id:string|null;
 draft:RequestDraft|null;entry_kind:string|null;entry_at:Date|null;entry_by:string|null;reissued:boolean};

const ROWS_SQL=`SELECT r.id release_id,r.case_id,r.round_id,r.certified_at,l.ln,i.hn,c.registration_origin,
  (SELECT s.unit_id FROM case_unit_scope s WHERE s.case_id=r.case_id ORDER BY s.unit_id LIMIT 1) unit_id,
  w.draft,COALESCE(NULLIF(btrim(pet.parsed->>'name'),''),NULLIF(btrim(w.draft#>>'{patient,syntheticName}'),'')) AS name,
  e.kind entry_kind,e.at entry_at,COALESCE(NULLIF(btrim(u.display_name),''),u.username) entry_by,
  EXISTS(SELECT 1 FROM result_release p WHERE p.round_id=r.round_id AND p.kind='RESULT' AND p.id<>r.id
   AND (SELECT x.kind FROM nhso_result_entry_event x WHERE x.release_id=p.id ORDER BY x.sequence DESC LIMIT 1)='CONFIRMED') reissued
 FROM result_release r JOIN nipt_case c ON c.id=r.case_id JOIN specimen_round s ON s.id=r.round_id JOIN case_ln l ON l.id=s.case_ln_id
 LEFT JOIN p2_case_identity i ON i.case_id=c.id
 LEFT JOIN LATERAL (SELECT w.draft FROM p2_workspace w JOIN specimen_round x ON x.id=w.round_id
   WHERE w.case_id=r.case_id AND COALESCE(btrim(w.draft#>>'{patient,entitlement}'),'')<>''
   ORDER BY (w.round_id=r.round_id) DESC,x.round_number DESC LIMIT 1) w ON true
 LEFT JOIN LATERAL (SELECT f.parsed FROM his_order_current o JOIN his_inbound_file_current f ON f.id=o.inbound_file_id
   WHERE o.round_id=r.round_id ORDER BY o.his_received_at DESC LIMIT 1) pet ON true
 LEFT JOIN LATERAL (SELECT x.kind,x.at,x.actor_id FROM nhso_result_entry_event x WHERE x.release_id=r.id ORDER BY x.sequence DESC LIMIT 1) e ON true
 LEFT JOIN app_user u ON u.id=e.actor_id
 WHERE r.state='Active' AND r.kind='RESULT' AND c.registration_origin<>'HISTORICAL'
  AND NOT EXISTS(SELECT 1 FROM eqa_case q WHERE q.case_id=r.case_id)`;

/** Only a case the user may see, whose request says สปสช. */
const eligible=(user:Staff,r:R)=>entitlementKind(r.draft?.patient?.entitlement)==='NHSO'&&caseVisible(user,{unit_id:r.unit_id,registration_origin:r.registration_origin});
const toRow=(r:R):NhsoRow=>({releaseId:r.release_id,caseId:r.case_id,ln:r.ln,hn:r.hn,name:r.name,certifiedAt:new Date(r.certified_at).toISOString(),reissued:r.reissued,
 entry:r.entry_kind==='CONFIRMED'&&r.entry_at?{at:new Date(r.entry_at).toISOString(),by:r.entry_by}:null});

const boardSchema=z.strictObject({tab:z.enum(['PENDING','DONE']),q:z.string().trim().max(40).default(''),page:z.number().int().min(1).max(1000).default(1),pageSize:z.number().int().min(10).max(100).default(50)});
/** Upper bound of releases one board call reads; `truncated` says it cut rows off. */
export const NHSO_CAP=5000;

export async function nhsoBoard(db:Queryable,user:Staff,input:unknown,cap=NHSO_CAP){
 await assertSession(db,user);need(user,'nhso.entry','read');
 const d=boardSchema.parse(input),q=d.q.replace(/[%_\\-]/g,'');
 const fetched=(await db.query<R>(`${ROWS_SQL}
   AND ($1='' OR l.ln LIKE $1||'%' OR ltrim(COALESCE(i.hn,''),'0') LIKE ltrim($1,'0')||'%')
  ORDER BY r.certified_at,r.id LIMIT $2`,[q,cap+1])).rows;
 const truncated=fetched.length>cap,all=fetched.slice(0,cap).filter(r=>eligible(user,r));
 const done=all.filter(r=>r.entry_kind==='CONFIRMED'),pending=all.filter(r=>r.entry_kind!=='CONFIRMED');
 // Pending: oldest release first (work the queue in order). Entered: most recently entered first.
 const list=d.tab==='PENDING'?pending:done.sort((a,b)=>new Date(b.entry_at!).getTime()-new Date(a.entry_at!).getTime());
 const total=list.length,start=(d.page-1)*d.pageSize,slice=list.slice(start,start+d.pageSize);
 await recordPhiAccess(db,user.id,slice.map(r=>r.case_id),'REGISTRY_VIEW');
 return {rows:slice.map(toRow),counts:{PENDING:pending.length,DONE:done.length},truncated,
  page:{number:d.page,size:d.pageSize,total,totalPages:Math.max(1,Math.ceil(total/d.pageSize)),hasNext:start+d.pageSize<total}};
}

async function eligibleRelease(db:Queryable,user:Staff,releaseId:string){
 const r=(await db.query<R>(`${ROWS_SQL} AND r.id=$1`,[uuid.parse(releaseId)])).rows[0];
 if(!r||!eligible(user,r))throw new LabError('NOT_FOUND',404);
 return r;
}

export type NhsoDetail={row:NhsoRow;patient:{nationalId:string|null;ageYears:number|null;gravida:number|null;gaWeeks:number|null;gaDays:number|null;serviceDate:string|null;testDate:string|null}};

/** The popup's patient data. The national ID is read from the stored PET bytes only here, never persisted in clear. */
export async function nhsoDetail(db:Queryable,store:FileStore,user:Staff,releaseId:string):Promise<NhsoDetail>{
 await assertSession(db,user);need(user,'nhso.entry','read');
 const r=await eligibleRelease(db,user,releaseId);
 const round=(await db.query<{received_at:Date|null}>('SELECT received_at FROM specimen_round_current WHERE id=$1',[r.round_id])).rows[0];
 // The PET of this round; a round without its own PET (e.g. a redraw received in NIPT) uses the case's latest one.
 const file=(await db.query<{sha256:string;filename:string;dob:string|null;received:string|null}>(`SELECT f.sha256,f.filename,left(f.parsed->>'dob',10) dob,f.parsed->>'receivedAt' received
   FROM his_order_current o JOIN his_inbound_file_current f ON f.id=o.inbound_file_id JOIN specimen_round x ON x.id=o.round_id
   WHERE x.case_id=$1 ORDER BY (o.round_id=$2) DESC,x.round_number DESC,o.his_received_at DESC LIMIT 1`,[r.case_id,r.round_id])).rows[0];
 let nationalId:string|null=null;
 if(file){try{nationalId=parsePet(await store.get(file.sha256),file.filename).identity.trim()||null;}catch{nationalId=null;}}
 const receivedAt=round?.received_at??(file?.received?new Date(file.received):null);
 const serviceDate=receivedAt?bangkokIsoDay(new Date(receivedAt)):null;
 const dob=file?.dob??r.draft?.patient?.dob??null;
 const reg=(await db.query<{ga_weeks:number|null;ga_days:number|null}>('SELECT ga_weeks,ga_days FROM lab_operational_registration WHERE round_id=$1',[r.round_id])).rows[0];
 let ga:{weeks:number;days:number}|null=reg&&reg.ga_weeks!==null&&reg.ga_days!==null?{weeks:reg.ga_weeks,days:reg.ga_days}:null;
 if(!ga&&r.draft?.pregnancy){try{ga=gaParts(calculations(r.draft).gaDays);}catch{ga=null;}}
 const task=(await db.query<{at:Date|null}>(`SELECT min(a.assigned_at) at FROM result_release rr JOIN result_report_version v ON v.id=rr.version_id
   JOIN lab_slot_assignment a ON a.attempt_id=v.attempt_id AND a.removed_at IS NULL WHERE rr.id=$1`,[r.release_id])).rows[0];
 const gravida=r.draft?.pregnancy?.gravida;
 await recordPhiAccess(db,user.id,[r.case_id],'CASE_DETAIL_VIEW');
 return {row:toRow(r),patient:{nationalId,ageYears:ageOnDate(dob,serviceDate),gravida:typeof gravida==='number'?gravida:null,gaWeeks:ga?.weeks??null,gaDays:ga?.days??null,
  serviceDate,testDate:task?.at?bangkokIsoDay(new Date(task.at)):null}};
}

const actionSchema=z.strictObject({releaseId:uuid});
async function record(db:Queryable,user:Staff,input:unknown,kind:'CONFIRMED'|'CANCELLED'){
 await assertSession(db,user);need(user,'nhso.entry','write');
 const {releaseId}=actionSchema.parse(input);
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['nhso:'+releaseId]);
 const r=await eligibleRelease(db,user,releaseId);
 if(kind==='CONFIRMED'&&r.entry_kind==='CONFIRMED')throw new LabError('NHSO_ALREADY_CONFIRMED',409);
 if(kind==='CANCELLED'&&r.entry_kind!=='CONFIRMED')throw new LabError('NHSO_NOT_CONFIRMED',409);
 await db.query('INSERT INTO nhso_result_entry_event(release_id,kind,actor_id) VALUES($1,$2,$3)',[r.release_id,kind,user.id]);
 await audit(db,user,kind==='CONFIRMED'?'NHSO_ENTRY_CONFIRMED':'NHSO_ENTRY_CANCELLED','RESULT_RELEASE',r.release_id,{resultingState:kind});
 return {releaseId:r.release_id,state:kind};
}
export const confirmNhsoEntry=(db:Queryable,user:Staff,input:unknown)=>record(db,user,input,'CONFIRMED');
export const cancelNhsoEntry=(db:Queryable,user:Staff,input:unknown)=>record(db,user,input,'CANCELLED');
