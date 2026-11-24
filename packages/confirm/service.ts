import {z} from 'zod';
import type {Queryable} from '../db/connection';
import type {FileStore} from '../storage';
import {assertSession,need,caseVisible,audit,uuid,LabError,type Staff} from '../lab/core';
import {patientDisplayName} from '../domain/patient-name';
import {bangkokIsoDay} from '../domain/thai-date';
import {recordPhiAccess} from '../db/phi-access';
import {fiscalYear} from '../anc/model';
import {historicalReportedAtSql,positiveKeysSql,POSITIVE_KEYS} from '../results/query';
import {TABS,tabOf,hasResult,concordant,isPdf,saveInput,PDF_MAX_BYTES,
 type FindingKey,type Outcome,type ConfirmStatus,type ConfirmTab,type Method,type Specimen} from './model';

// ผลตรวจยืนยัน (Confirm) (Owner 2026-11-23). Every High Risk case (the registry's definition, anc/high-risk-sql.ts: a positive finding in the case's
// Active certified release or in a result the previous system reported) is followed here until its confirmatory result is recorded.
// The screening result compared is the case's latest positive result; its findings are the result's positive keys (results/query.ts positiveKeysSql),
// or `other` for an abnormal result without one. The record is the latest confirm_result_revision of (case, screening version) (migration 231).

type Raw={case_id:string;version_id:string;certified_at:Date;ln:string;ln_halos:string|null;hn:string|null;name:string|null;registration_origin:string;unit_id:string|null;
 keys:string[]|null;abnormal:boolean;seq:string|null;status:ConfirmStatus|null;method:Method|null;specimen:Specimen|null;outlab_name:string|null;procedure_date:string|null;report_date:string|null;
 result_text:string|null;report_sha256:string|null;findings:Record<string,Outcome>|null;note:string|null;at:Date|null;by:string|null};

/** The latest positive screening result of every case, with the current confirm revision for it. */
const ROWS_SQL=`WITH subj AS (
  SELECT rr.version_id,rr.case_id,rr.certified_at FROM result_release rr WHERE rr.state='Active' AND rr.kind='RESULT'
  UNION ALL
  SELECT h.version_id,h.case_id,${historicalReportedAtSql} FROM historical_reported_result h JOIN result_report_version v ON v.id=h.version_id WHERE v.kind='RESULT'),
 pos AS (SELECT s.*,${positiveKeysSql} keys,COALESCE((v.parsed->>'abnormal')::boolean,false) abnormal,v.round_id
  FROM subj s JOIN result_report_version v ON v.id=s.version_id),
 latest AS (SELECT DISTINCT ON (case_id) * FROM pos WHERE cardinality(keys)>0 OR abnormal ORDER BY case_id,certified_at DESC,version_id)
 SELECT p.case_id,p.version_id,p.certified_at,p.keys,p.abnormal,l.ln,n.ln_halos,i.hn,c.registration_origin,
  (SELECT s.unit_id FROM case_unit_scope s WHERE s.case_id=p.case_id ORDER BY s.unit_id LIMIT 1) unit_id,
  COALESCE(NULLIF(btrim(pet.parsed->>'name'),''),NULLIF(btrim(w.draft#>>'{patient,syntheticName}'),'')) AS name,
  x.sequence::text seq,x.status,x.method,x.specimen,x.outlab_name,x.procedure_date::text,x.report_date::text,x.result_text,x.report_sha256,x.findings,x.note,x.at,
  COALESCE(NULLIF(btrim(u.display_name),''),u.username) "by"
 FROM latest p JOIN nipt_case c ON c.id=p.case_id JOIN specimen_round s ON s.id=p.round_id JOIN case_ln l ON l.id=s.case_ln_id
 LEFT JOIN specimen_lab_number n ON n.round_id=p.round_id
 LEFT JOIN p2_case_identity i ON i.case_id=c.id
 LEFT JOIN LATERAL (SELECT w.draft FROM p2_workspace w JOIN specimen_round y ON y.id=w.round_id WHERE w.case_id=p.case_id ORDER BY (w.round_id=p.round_id) DESC,y.round_number DESC LIMIT 1) w ON true
 LEFT JOIN LATERAL (SELECT f.parsed FROM his_order_current o JOIN his_inbound_file_current f ON f.id=o.inbound_file_id WHERE o.round_id=p.round_id ORDER BY o.his_received_at DESC LIMIT 1) pet ON true
 LEFT JOIN LATERAL (SELECT r.* FROM confirm_result_revision r WHERE r.case_id=p.case_id AND r.version_id=p.version_id ORDER BY r.sequence DESC LIMIT 1) x ON true
 LEFT JOIN app_user u ON u.id=x.actor_id
 WHERE c.registration_origin<>'HISTORICAL' AND NOT EXISTS(SELECT 1 FROM eqa_case q WHERE q.case_id=p.case_id)`;

export type ConfirmRecord={sequence:number;status:ConfirmStatus;method:Method|null;specimen:Specimen|null;outlabName:string;procedureDate:string|null;reportDate:string|null;
 resultText:string;hasReport:boolean;findings:Partial<Record<FindingKey,Outcome>>;note:string;at:string;by:string|null};
/** One followed case. `screen` = the findings of the screening result; `record` = null while nothing has been recorded (status รอผล). */
export type ConfirmRow={caseId:string;versionId:string;ln:string;lnHalos:string|null;hn:string|null;name:string|null;releasedAt:string;fiscalYear:number;
 screen:FindingKey[];status:ConfirmStatus;concordant:boolean|null;waitingDays:number|null;record:ConfirmRecord|null};

const screenOf=(r:Raw):FindingKey[]=>{const keys=POSITIVE_KEYS.filter(k=>(r.keys??[]).includes(k));return keys.length?keys:r.abnormal?['other']:[];};
const dayMs=86400000;
function toRow(r:Raw,now:Date):ConfirmRow{
 const screen=screenOf(r),status:ConfirmStatus=r.status??'PENDING',released=new Date(r.certified_at);
 const record:ConfirmRecord|null=r.seq&&r.status&&r.at?{sequence:Number(r.seq),status:r.status,method:r.method,specimen:r.specimen,outlabName:r.outlab_name??'',procedureDate:r.procedure_date,reportDate:r.report_date,
  resultText:r.result_text??'',hasReport:!!r.report_sha256,findings:r.findings??{},note:r.note??'',at:new Date(r.at).toISOString(),by:r.by}:null;
 const waiting=status==='PENDING'?Math.max(0,Math.round((Date.parse(bangkokIsoDay(now))-Date.parse(bangkokIsoDay(released)))/dayMs)):null;
 return {caseId:r.case_id,versionId:r.version_id,ln:r.ln,lnHalos:r.ln_halos,hn:r.hn,name:r.name?patientDisplayName(r.name):null,releasedAt:released.toISOString(),
  fiscalYear:fiscalYear(released.toISOString()),screen,status,concordant:record&&hasResult(status)?concordant(record.findings,screen):null,waitingDays:waiting,record};
}

/** Every followed case the user may see (case.read scope), oldest result first. */
export async function followedRows(db:Queryable,user:Staff,now=new Date(),where='',values:unknown[]=[]){
 const rows=(await db.query<Raw>(`${ROWS_SQL}${where} ORDER BY p.certified_at,p.case_id`,values)).rows;
 return rows.filter(r=>caseVisible(user,{unit_id:r.unit_id,registration_origin:r.registration_origin})).map(r=>toRow(r,now));
}

const listSchema=z.strictObject({tab:z.enum(TABS).default('ALL'),q:z.string().trim().max(40).default(''),fy:z.number().int().min(2543).max(2743).nullable().default(null),
 page:z.number().int().min(1).max(1000).default(1),pageSize:z.number().int().min(10).max(100).default(50)});

/** The list of one tab (search by LN or HN in the POST body, never a URL). Counts ignore the tab but follow the fiscal year and search. */
export async function confirmBoard(db:Queryable,user:Staff,input:unknown,now=new Date()){
 await assertSession(db,user);need(user,'confirm.read','read');
 const d=listSchema.parse(input),q=d.q.replace(/[%_\-\s]/g,'');
 const all=(await followedRows(db,user,now,` AND ($1='' OR l.ln LIKE $1||'%' OR ltrim(COALESCE(i.hn,''),'0') LIKE ltrim($1,'0')||'%')`,[q])).filter(r=>d.fy===null||r.fiscalYear===d.fy);
 const counts:Record<ConfirmTab,number>={ALL:all.length,PENDING:0,RESULTED:0,NOT_DONE:0};
 for(const r of all)counts[tabOf(r.status)]++;
 // Waiting cases first (longest wait first), then the most recently recorded.
 const list=(d.tab==='ALL'?all:all.filter(r=>tabOf(r.status)===d.tab)).sort((a,b)=>(b.waitingDays??-1)-(a.waitingDays??-1)||(b.record?.at??'').localeCompare(a.record?.at??''));
 const start=(d.page-1)*d.pageSize,slice=list.slice(start,start+d.pageSize);
 await recordPhiAccess(db,user.id,slice.map(r=>r.caseId),'REGISTRY_VIEW');
 return {rows:slice,counts,fiscalYears:[...new Set((await followedRows(db,user,now)).map(r=>r.fiscalYear))].sort((a,b)=>b-a),
  page:{number:d.page,size:d.pageSize,total:list.length,totalPages:Math.max(1,Math.ceil(list.length/d.pageSize)),hasNext:start+d.pageSize<list.length}};
}

async function followed(db:Queryable,user:Staff,caseId:string,now=new Date()){
 const row=(await followedRows(db,user,now,' AND p.case_id=$1',[uuid.parse(caseId)]))[0];
 if(!row)throw new LabError('NOT_FOUND',404);
 return row;
}

export type ConfirmHistory={sequence:number;status:ConfirmStatus;at:string;by:string|null;hasReport:boolean};
/** One case for the editor: the row and every earlier revision (newest first). */
export async function confirmDetail(db:Queryable,user:Staff,caseId:string,now=new Date()){
 await assertSession(db,user);need(user,'confirm.read','read');
 const row=await followed(db,user,caseId,now);
 const history=(await db.query<{sequence:string;status:ConfirmStatus;at:Date;by:string|null;report_sha256:string|null}>(`SELECT r.sequence::text,r.status,r.at,COALESCE(NULLIF(btrim(u.display_name),''),u.username) "by",r.report_sha256
  FROM confirm_result_revision r LEFT JOIN app_user u ON u.id=r.actor_id WHERE r.case_id=$1 AND r.version_id=$2 ORDER BY r.sequence DESC`,[row.caseId,row.versionId])).rows
  .map(h=>({sequence:Number(h.sequence),status:h.status,at:new Date(h.at).toISOString(),by:h.by,hasReport:!!h.report_sha256}));
 await recordPhiAccess(db,user.id,[row.caseId],'CASE_DETAIL_VIEW');
 return {row,history};
}

/**
 * Record a new revision. A result status (มีผลแล้ว / ใช้ผลหลังคลอด) needs the outlab PDF (a new one, or the one already recorded) and an outcome for exactly
 * the screening findings; any other status keeps only its note. The revision the user saw must still be the latest one (CONFIRM_CHANGED otherwise),
 * and the screening result must still be the case's latest positive result (CONFIRM_SCREEN_CHANGED).
 */
export async function saveConfirm(db:Queryable,store:FileStore,user:Staff,raw:unknown,pdf?:Buffer|null,now=new Date()){
 await assertSession(db,user);need(user,'confirm.write','write');
 const d=saveInput.parse(raw);
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['confirm:'+d.caseId]);
 const row=await followed(db,user,d.caseId,now);
 if(row.versionId!==d.versionId)throw new LabError('CONFIRM_SCREEN_CHANGED',409);
 if((row.record?.sequence??null)!==d.expectedSequence)throw new LabError('CONFIRM_CHANGED',409);
 if(pdf&&(pdf.length>PDF_MAX_BYTES))throw new LabError('FILE_TOO_LARGE',413);
 if(pdf&&!isPdf(pdf))throw new LabError('CONFIRM_NOT_PDF',422);
 const result=hasResult(d.status);
 let sha:string|null=null;
 if(result){
  const keys=Object.keys(d.findings) as FindingKey[];
  if(keys.length!==row.screen.length||!row.screen.every(k=>d.findings[k]))throw new LabError('CONFIRM_FINDINGS_INCOMPLETE',422);
  if(!d.method)throw new LabError('CONFIRM_METHOD_REQUIRED',422);
  if(pdf){
   sha=await store.put(pdf);
   await db.query("INSERT INTO file_asset(sha256,byte_size,media_type,storage_key) VALUES($1,$2,'application/pdf',$3) ON CONFLICT(sha256) DO NOTHING",[sha,pdf.length,`sha256/${sha.slice(0,2)}/${sha.slice(2,4)}/${sha}`]);
  }else{
   sha=(await db.query<{report_sha256:string|null}>('SELECT report_sha256 FROM confirm_result_revision WHERE case_id=$1 AND version_id=$2 ORDER BY sequence DESC LIMIT 1',[row.caseId,row.versionId])).rows[0]?.report_sha256??null;
   if(!sha)throw new LabError('CONFIRM_PDF_REQUIRED',422);
  }
 }else if(pdf)throw new LabError('CONFIRM_PDF_ONLY_WITH_RESULT',422);
 const nul=(s:string)=>s||null;
 const ins=(await db.query<{sequence:string}>(`INSERT INTO confirm_result_revision(case_id,version_id,status,method,specimen,outlab_name,procedure_date,report_date,result_text,report_sha256,findings,note,actor_id)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING sequence::text`,
  [row.caseId,row.versionId,d.status,result?d.method:null,result?d.specimen:null,result?nul(d.outlabName):null,result?d.procedureDate:null,result?d.reportDate:null,result?nul(d.resultText):null,
   sha,JSON.stringify(result?d.findings:{}),nul(d.note),user.id])).rows[0];
 // Audit details are allow-listed codes; the finding outcomes themselves are in the revision.
 await audit(db,user,'CONFIRM_RESULT_RECORDED','NIPT_CASE',row.caseId,{resultingState:d.status,previousState:row.status,version:Number(ins.sequence),
  outcome:result?(concordant(d.findings,row.screen)?'CONCORDANT':'DISCORDANT'):'NO_RESULT',reasonCode:pdf?'NEW_PDF':result?'KEPT_PDF':'NO_PDF'});
 return {caseId:row.caseId,sequence:Number(ins.sequence),status:d.status};
}

/** The outlab PDF of the current record (or of an earlier revision of the same case), for viewing in the browser. */
export async function confirmReport(db:Queryable,store:FileStore,user:Staff,caseId:string,sequence?:number){
 await assertSession(db,user);need(user,'confirm.read','read');
 const row=await followed(db,user,caseId);
 const seq=sequence??row.record?.sequence;
 if(!seq||!Number.isInteger(seq))throw new LabError('NOT_FOUND',404);
 const sha=(await db.query<{report_sha256:string|null}>('SELECT report_sha256 FROM confirm_result_revision WHERE case_id=$1 AND sequence=$2',[row.caseId,seq])).rows[0]?.report_sha256;
 if(!sha)throw new LabError('NOT_FOUND',404);
 await recordPhiAccess(db,user.id,[row.caseId],'CASE_DETAIL_VIEW');
 return {bytes:await store.get(sha),name:`confirm-${row.ln}.pdf`};
}

/** The full NIPT screening report (the exact released PDF) of the case's followed result, for the confirm screen (Owner 2026-11-24). Same scope and access log as the rest. */
export async function confirmScreeningReport(db:Queryable,store:FileStore,user:Staff,caseId:string){
 await assertSession(db,user);need(user,'confirm.read','read');
 const row=await followed(db,user,caseId);
 const f=(await db.query<{sha256:string;container:string}>('SELECT v.sha256,f.container FROM result_report_version v JOIN result_intake_file f ON f.id=v.intake_file_id WHERE v.id=$1',[row.versionId])).rows[0];
 if(!f||f.container!=='PDF')throw new LabError('NOT_FOUND',404);
 await recordPhiAccess(db,user.id,[row.caseId],'CASE_DETAIL_VIEW');
 return {bytes:await store.get(f.sha256),name:`nipt-${row.ln}.pdf`};
}


