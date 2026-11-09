import {patientDisplayName} from '../domain/patient-name';
import {z} from 'zod';
import type {Queryable} from '../db/connection';
import type {FileStore} from '../storage';
import {assertSession,need,caseVisible,audit,uuid,LabError,type Staff} from '../lab/core';
import {entitlementKind} from '../forms/request-contract';
import {parsePet} from '../integrations/pet';
import {ageOnDate,type RequestDraft} from '../p2/schema';
import {bangkokIsoDay,formatBe,formatBeDateTime} from '../domain/thai-date';
import {simpleXlsx} from '../workbook/simple-xlsx';
import {gaFromEdd} from './nhso-format';
import {recordPhiAccess} from '../db/phi-access';

// ลงผลสปสช. (Owner 2026-11-09). Lists every certified, Active result of a patient whose request records the NHSO (สปสช.) entitlement;
// staff copy the patient data into the NHSO system and confirm here. The state is the latest nhso_result_entry_event of that release
// (migration 208). A reissued result is a new release, so it comes back as pending with `reissued` set.
export type NhsoTab='PENDING'|'DONE'|'NOT_NHSO';
/** `entitlement` UNSPECIFIED = the request chose neither สปสช. nor self-pay (treated as สปสช.). `entry` is the current CONFIRMED / NOT_NHSO decision, if any. */
export type NhsoRow={resultId:string;caseId:string;ln:string;lnHalos:string|null;hn:string|null;name:string|null;certifiedAt:string;reissued:boolean;entitlement:'NHSO'|'UNSPECIFIED';entry:{kind:'CONFIRMED'|'NOT_NHSO';at:string;by:string|null}|null};

type R={subject_id:string;source:'RELEASE'|'HISTORICAL';version_id:string;case_id:string;round_id:string;certified_at:Date;ln:string;ln_halos:string|null;hn:string|null;name:string|null;registration_origin:string;unit_id:string|null;
 draft:RequestDraft|null;entitlement:string|null;entry_kind:string|null;entry_at:Date|null;entry_by:string|null;reissued:boolean};

/** Same meaning as ANC's "มีผลตรวจแล้ว": a certified NIPT-CBH release, or a result HIS already holds / the previous system reported (historical_reported_result, no release).
 *  `subject_id` is the release id for the first and the result version id for the second. */
const ROWS_SQL=`WITH subj AS (
  SELECT rr.id subject_id,'RELEASE' source,rr.version_id,rr.case_id,rr.round_id,rr.certified_at FROM result_release rr WHERE rr.state='Active' AND rr.kind='RESULT'
  UNION ALL
  SELECT h.version_id,'HISTORICAL',h.version_id,h.case_id,h.round_id,h.imported_at FROM historical_reported_result h)
 SELECT r.subject_id,r.source,r.version_id,r.case_id,r.round_id,r.certified_at,l.ln,n.ln_halos,i.hn,c.registration_origin,
  (SELECT s.unit_id FROM case_unit_scope s WHERE s.case_id=r.case_id ORDER BY s.unit_id LIMIT 1) unit_id,
  w.draft,ent.entitlement,COALESCE(NULLIF(btrim(pet.parsed->>'name'),''),NULLIF(btrim(w.draft#>>'{patient,syntheticName}'),'')) AS name,
  e.kind entry_kind,e.at entry_at,COALESCE(NULLIF(btrim(u.display_name),''),u.username) entry_by,
  (r.source='RELEASE' AND EXISTS(SELECT 1 FROM result_release p WHERE p.round_id=r.round_id AND p.kind='RESULT' AND p.id<>r.subject_id
   AND (SELECT x.kind FROM nhso_result_entry_event x WHERE x.release_id=p.id ORDER BY x.sequence DESC LIMIT 1)='CONFIRMED')) reissued
 FROM subj r JOIN nipt_case c ON c.id=r.case_id JOIN specimen_round s ON s.id=r.round_id JOIN case_ln l ON l.id=s.case_ln_id LEFT JOIN specimen_lab_number n ON n.round_id=r.round_id
 LEFT JOIN p2_case_identity i ON i.case_id=c.id
 LEFT JOIN LATERAL (SELECT w.draft FROM p2_workspace w JOIN specimen_round x ON x.id=w.round_id
   WHERE w.case_id=r.case_id ORDER BY (w.round_id=r.round_id) DESC,x.round_number DESC LIMIT 1) w ON true
 LEFT JOIN LATERAL (SELECT btrim(w2.draft#>>'{patient,entitlement}') entitlement FROM p2_workspace w2 JOIN specimen_round x2 ON x2.id=w2.round_id
   WHERE w2.case_id=r.case_id AND COALESCE(btrim(w2.draft#>>'{patient,entitlement}'),'')<>''
   ORDER BY (w2.round_id=r.round_id) DESC,x2.round_number DESC LIMIT 1) ent ON true
 LEFT JOIN LATERAL (SELECT f.parsed FROM his_order_current o JOIN his_inbound_file_current f ON f.id=o.inbound_file_id
   WHERE o.round_id=r.round_id ORDER BY o.his_received_at DESC LIMIT 1) pet ON true
 LEFT JOIN LATERAL (SELECT x.kind,x.at,x.actor_id FROM nhso_result_entry_event x WHERE (r.source='RELEASE' AND x.release_id=r.subject_id) OR (r.source='HISTORICAL' AND x.version_id=r.subject_id) ORDER BY x.sequence DESC LIMIT 1) e ON true
 LEFT JOIN app_user u ON u.id=e.actor_id
 WHERE c.registration_origin<>'HISTORICAL'
  AND NOT EXISTS(SELECT 1 FROM eqa_case q WHERE q.case_id=r.case_id)`;

/** Owner 2026-11-09: only an explicit "self-pay / เรียกเก็บ" entitlement stays out. A case that chose neither (blank, paper request from the Lab, unrecognised text)
 *  is treated as สปสช.; staff can mark it "not สปสช." on this page. Only cases the user may see. */
const kindOf=(r:R)=>entitlementKind(r.entitlement);
const eligible=(user:Staff,r:R)=>kindOf(r)!=='SELF_PAY'&&caseVisible(user,{unit_id:r.unit_id,registration_origin:r.registration_origin});
const toRow=(r:R):NhsoRow=>({resultId:r.subject_id,caseId:r.case_id,ln:r.ln,lnHalos:r.ln_halos,hn:r.hn,name:r.name?patientDisplayName(r.name):null,certifiedAt:new Date(r.certified_at).toISOString(),reissued:r.reissued,
 entitlement:kindOf(r)==='NHSO'?'NHSO':'UNSPECIFIED',
 entry:(r.entry_kind==='CONFIRMED'||r.entry_kind==='NOT_NHSO')&&r.entry_at?{kind:r.entry_kind,at:new Date(r.entry_at).toISOString(),by:r.entry_by}:null});

const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(v)),'DATE_INVALID');
const filter={tab:z.enum(['PENDING','DONE','NOT_NHSO']),q:z.string().trim().max(40).default(''),from:day.optional(),to:day.optional()};
const boardSchema=z.strictObject({...filter,page:z.number().int().min(1).max(1000).default(1),pageSize:z.number().int().min(10).max(100).default(50)});
const exportSchema=z.strictObject(filter);
/** Upper bound of releases one board call reads; `truncated` says it cut rows off. */
export const NHSO_CAP=5000;

/** The visible, filtered list of one tab. The date range applies to the date that tab shows: certified day for PENDING, decision day for DONE / NOT_NHSO (Bangkok days).
 *  The counts of the three tabs ignore the date range so the cards keep showing totals. */
async function selectRows(db:Queryable,user:Staff,d:{tab:NhsoTab;q:string;from?:string;to?:string},cap:number){
 const q=d.q.replace(/[%_\-]/g,'');
 const fetched=(await db.query<R>(`${ROWS_SQL}
   AND ($1='' OR l.ln LIKE $1||'%' OR ltrim(COALESCE(i.hn,''),'0') LIKE ltrim($1,'0')||'%')
  ORDER BY n.ln_halos NULLS LAST,r.certified_at,r.subject_id LIMIT $2`,[q,cap+1])).rows;
 const truncated=fetched.length>cap,all=fetched.slice(0,cap).filter(r=>eligible(user,r));
 const done=all.filter(r=>r.entry_kind==='CONFIRMED'),notNhso=all.filter(r=>r.entry_kind==='NOT_NHSO'),pending=all.filter(r=>r.entry_kind!=='CONFIRMED'&&r.entry_kind!=='NOT_NHSO');
 // Pending: oldest release first (work the queue in order). Entered / marked not สปสช.: most recent first.
 const recent=(rows:R[])=>rows.sort((a,b)=>new Date(b.entry_at!).getTime()-new Date(a.entry_at!).getTime());
 const inRange=(r:R)=>{const at=d.tab==='PENDING'?r.certified_at:r.entry_at;if(!at)return false;const x=bangkokIsoDay(new Date(at));return(!d.from||x>=d.from)&&(!d.to||x<=d.to);};
 const list=(d.tab==='PENDING'?pending:recent(d.tab==='DONE'?done:notNhso)).filter(inRange);
 return {list,truncated,counts:{PENDING:pending.length,DONE:done.length,NOT_NHSO:notNhso.length}};
}

export async function nhsoBoard(db:Queryable,user:Staff,input:unknown,cap=NHSO_CAP){
 await assertSession(db,user);need(user,'nhso.entry','read');
 const d=boardSchema.parse(input),{list,truncated,counts}=await selectRows(db,user,d,cap);
 const total=list.length,start=(d.page-1)*d.pageSize,slice=list.slice(start,start+d.pageSize);
 await recordPhiAccess(db,user.id,slice.map(r=>r.case_id),'REGISTRY_VIEW');
 return {rows:slice.map(toRow),counts,truncated,
  page:{number:d.page,size:d.pageSize,total,totalPages:Math.max(1,Math.ceil(total/d.pageSize)),hasNext:start+d.pageSize<total}};
}

const formatLn=(v:string)=>/^\d{10}$/.test(v)?`${v.slice(0,2)}-${v.slice(2,5)}-${v.slice(5,6)}-${v.slice(6)}`:v;
const STATUS_TEXT:Record<NhsoTab,string>={PENDING:'ต้องลงผล',DONE:'ลงผลแล้ว',NOT_NHSO:'ไม่ใช่สิทธิ สปสช.'};
/** Excel of one tab with the same search and date range as the screen, for the monthly check against สปสช. Names and national IDs are not exported (LN and HN identify the case);
 *  the export is recorded as PHI access and in the audit. A list longer than the cap is refused rather than exported cut off. */
export async function exportNhsoXlsx(db:Queryable,user:Staff,input:unknown,cap=NHSO_CAP){
 await assertSession(db,user);need(user,'nhso.entry','read');
 const d=exportSchema.parse(input),{list,truncated}=await selectRows(db,user,d,cap);
 if(truncated)throw new LabError('NHSO_EXPORT_TOO_LARGE',409);
 for(let i=0;i<list.length;i+=200)await recordPhiAccess(db,user.id,list.slice(i,i+200).map(r=>r.case_id),'REGISTRY_VIEW');
 const be=(x:Date)=>formatBe(bangkokIsoDay(new Date(x)));
 const table=[['ลำดับ','LN','LN Halos','HN','วันที่ออกผล','สิทธิ','สถานะ','วันที่/เวลาที่บันทึก','ผู้บันทึก'],
  ...list.map((r,i)=>[String(i+1),formatLn(r.ln),r.ln_halos??'',r.hn??'',be(r.certified_at),kindOf(r)==='NHSO'?'สปสช.':'ไม่ได้ระบุสิทธิ',STATUS_TEXT[d.tab],
   r.entry_at&&d.tab!=='PENDING'?formatBeDateTime(new Date(r.entry_at)):'',d.tab!=='PENDING'?(r.entry_by??''):''])];
 await audit(db,user,'NHSO_ENTRY_EXPORTED','RESULT_RELEASE',undefined,{count:list.length,outcome:'XLSX'});
 return {bytes:simpleXlsx('ลงผลสปสช.',table),count:list.length,table};
}

async function eligibleRelease(db:Queryable,user:Staff,resultId:string){
 const r=(await db.query<R>(`${ROWS_SQL} AND r.subject_id=$1`,[uuid.parse(resultId)])).rows[0];
 if(!r||!eligible(user,r))throw new LabError('NOT_FOUND',404);
 return r;
}

export type NhsoDetail={row:NhsoRow;patient:{nationalId:string|null;ageYears:number|null;gravida:number|null;gaWeeks:number|null;gaDays:number|null;serviceDate:string|null;testDate:string|null}};

/** The popup's patient data. The national ID is read from the stored PET bytes only here, never persisted in clear. */
export async function nhsoDetail(db:Queryable,store:FileStore,user:Staff,resultId:string):Promise<NhsoDetail>{
 await assertSession(db,user);need(user,'nhso.entry','read');
 const r=await eligibleRelease(db,user,resultId);
 const round=(await db.query<{received_at:Date|null}>('SELECT received_at FROM specimen_round_current WHERE id=$1',[r.round_id])).rows[0];
 // The PET of this round; a round without its own PET (e.g. a redraw received in NIPT) uses the case's latest one.
 const file=(await db.query<{sha256:string;filename:string;dob:string|null;drawn:string|null;received:string|null}>(`SELECT f.sha256,f.filename,left(f.parsed->>'dob',10) dob,left(f.parsed->>'specimenAt',10) drawn,f.parsed->>'receivedAt' received
   FROM his_order_current o JOIN his_inbound_file_current f ON f.id=o.inbound_file_id JOIN specimen_round x ON x.id=o.round_id
   WHERE x.case_id=$1 ORDER BY (o.round_id=$2) DESC,x.round_number DESC,o.his_received_at DESC LIMIT 1`,[r.case_id,r.round_id])).rows[0];
 let nationalId:string|null=null;
 if(file){try{nationalId=parsePet(await store.get(file.sha256),file.filename).identity.trim()||null;}catch{nationalId=null;}}
 const receivedAt=round?.received_at??(file?.received?new Date(file.received):null);
 const serviceDate=receivedAt?bangkokIsoDay(new Date(receivedAt)):null;
 const drawDay=file?.drawn&&/^\d{4}-\d{2}-\d{2}$/.test(file.drawn)?file.drawn:null;
 const dob=file?.dob??r.draft?.patient?.dob??null;
 // GA weeks/days and "ครรภ์ที่": a paper case's Lab staff record them in the paper request check (p2_paper_review.panel). GA is "at the draw of this round", so only this
 // round's check counts; gravida is the same for the whole pregnancy, so any round's check may supply it (this round first). Then the Lab registration, then the electronic request.
 const papers=(await db.query<{round_id:string;panel:{gaWeeks?:number|null;gaDays?:number|null;gravida?:number|null}}>(
  `SELECT round_id,panel FROM p2_paper_review WHERE case_id=$1 AND kind='REQUEST' ORDER BY (round_id=$2) DESC,created_at DESC LIMIT 20`,[r.case_id,r.round_id])).rows;
 const paperGa=papers.find(p=>p.round_id===r.round_id&&Number.isInteger(p.panel?.gaWeeks)&&Number.isInteger(p.panel?.gaDays));
 const paperGravida=papers.find(p=>Number.isInteger(p.panel?.gravida))?.panel.gravida??null;
 const reg=(await db.query<{ga_weeks:number|null;ga_days:number|null}>('SELECT ga_weeks,ga_days FROM lab_operational_registration WHERE round_id=$1',[r.round_id])).rows[0];
 let ga:{weeks:number;days:number}|null=paperGa?{weeks:paperGa.panel.gaWeeks!,days:paperGa.panel.gaDays!}:reg&&reg.ga_weeks!==null&&reg.ga_days!==null?{weeks:reg.ga_weeks,days:reg.ga_days}:null;
 // Owner 2026-11-09: GA is counted at the blood-draw date, which the PET carries (specimenAt); the request's own draw date is the fallback, the service date the last resort.
 if(!ga)ga=gaFromEdd(r.draft?.pregnancy?.edd,drawDay??r.draft?.pregnancy?.collectionDate??serviceDate);
 // Owner 2026-11-09: the test date is the day the specimen was placed in the Task List, because placing it there starts the analysis.
 const task=(await db.query<{at:Date|null}>(`SELECT min(a.assigned_at) at FROM result_report_version v
   JOIN lab_slot_assignment a ON a.attempt_id=v.attempt_id AND a.removed_at IS NULL WHERE v.id=$1`,[r.version_id])).rows[0];
 const draftGravida=r.draft?.pregnancy?.gravida,gravida=typeof draftGravida==='number'?draftGravida:paperGravida;
 await recordPhiAccess(db,user.id,[r.case_id],'CASE_DETAIL_VIEW');
 return {row:toRow(r),patient:{nationalId,ageYears:ageOnDate(dob,serviceDate),gravida,gaWeeks:ga?.weeks??null,gaDays:ga?.days??null,
  serviceDate,testDate:task?.at?bangkokIsoDay(new Date(task.at)):null}};
}

const actionSchema=z.strictObject({resultId:uuid});
type Decision='CONFIRMED'|'NOT_NHSO'|'CANCELLED';
const AUDIT_ACTION:Record<Decision,string>={CONFIRMED:'NHSO_ENTRY_CONFIRMED',NOT_NHSO:'NHSO_ENTRY_MARKED_NOT_NHSO',CANCELLED:'NHSO_ENTRY_CANCELLED'};
/** CONFIRMED / NOT_NHSO only from pending; CANCELLED (back to pending) only from one of those two. Each is one insert-only event under a per-release lock. */
async function record(db:Queryable,user:Staff,input:unknown,kind:Decision){
 await assertSession(db,user);need(user,'nhso.entry','write');
 const {resultId}=actionSchema.parse(input);
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['nhso:'+resultId]);
 const r=await eligibleRelease(db,user,resultId);
 const decided=r.entry_kind==='CONFIRMED'||r.entry_kind==='NOT_NHSO';
 if(kind!=='CANCELLED'&&decided)throw new LabError('NHSO_ALREADY_DECIDED',409);
 if(kind==='CANCELLED'&&!decided)throw new LabError('NHSO_NOT_DECIDED',409);
 await db.query('INSERT INTO nhso_result_entry_event(release_id,version_id,kind,actor_id) VALUES($1,$2,$3,$4)',[r.source==='RELEASE'?r.subject_id:null,r.source==='HISTORICAL'?r.subject_id:null,kind,user.id]);
 await audit(db,user,AUDIT_ACTION[kind],r.source==='RELEASE'?'RESULT_RELEASE':'RESULT_VERSION',r.subject_id,{resultingState:kind});
 return {resultId:r.subject_id,state:kind};
}
export const confirmNhsoEntry=(db:Queryable,user:Staff,input:unknown)=>record(db,user,input,'CONFIRMED');
export const markNotNhso=(db:Queryable,user:Staff,input:unknown)=>record(db,user,input,'NOT_NHSO');
export const cancelNhsoEntry=(db:Queryable,user:Staff,input:unknown)=>record(db,user,input,'CANCELLED');
