import {currentPetPatientJoin} from './current-patient';
import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {assertSession,LabError,type Staff} from '../lab/core';
import {authorize} from '../security/policy';
import {fiscalYear,flagLabels,stages,type Dashboard,type QueueItem} from './model';

export const filterSchema=z.object({fy:z.coerce.number().int().min(2543).max(2743).optional(),unitId:z.uuid().optional(),kpi:z.enum(['sent','pending','released','attention']).optional(),stage:z.enum(stages.map(s=>s[0])).optional(),flag:z.enum(Object.keys(flagLabels) as [keyof typeof flagLabels,...(keyof typeof flagLabels)[]]).optional(),tab:z.enum(['all','pending','released','attention','redraw','hold']).optional(),q:z.string().trim().max(60).optional(),page:z.coerce.number().int().min(1).max(1000000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20),
 /** Keyset cursor of the last row already shown (from the previous response) and the time that response was computed at. Following a cursor
  * continues strictly after that row in the same total order, so a row that changes meanwhile can neither repeat nor push another row out;
  * `asOf` keeps "days waiting" (a sort key) from drifting across midnight while one person pages. Both are optional: without them the page is OFFSET-based. */
 after:z.string().max(300).optional(),asOf:z.iso.datetime().optional()}).strict();
export type Cursor={u:0|1;d:number;id:string};
const encodeCursor=(c:Cursor)=>Buffer.from(JSON.stringify(c)).toString('base64url');
function decodeCursor(raw:string):Cursor{
 try{return z.strictObject({u:z.union([z.literal(0),z.literal(1)]),d:z.number().int().min(-1).max(8640000000000000),id:z.uuid()}).parse(JSON.parse(Buffer.from(raw,'base64url').toString('utf8')));}
 catch{throw new LabError('INVALID_CURSOR',400);}
}

/** ANC roles need both case.read and result.read.released for each unit before facts are read.
 * EXISTS and scalar subqueries keep exactly one row per case, even for multiple unit scopes.
 * Documents use the authoritative p2_clinical_source and document portion of the readiness predicate
 * (migration 088; Paper Consent marker 101; refusal-aware decision 102). Collection-date/clinical-review gates remain separate from document readiness. */
export const factsSql=`SELECT c.created_at "registeredAt",c.id,l.ln,i.hn,CASE WHEN pet_patient.inbound_file_id IS NOT NULL THEN pet_patient.name ELSE COALESCE(NULLIF(btrim(w.draft#>>'{patient,syntheticName}'),''),patient_history.name) END "patientName",
 ARRAY(SELECT s.unit_id::text FROM case_unit_scope s WHERE s.case_id=c.id AND s.unit_id=ANY($1::uuid[]) ORDER BY s.unit_id) "unitIds",
 c.current_round_id "currentRoundId",r.round_number "roundNumber",r.state "roundState",
 (SELECT s.received_at FROM specimen_round s WHERE s.case_id=c.id AND s.round_number=1) "s1ReceivedAt",r.received_at "currentReceivedAt",COALESCE(r.analysis_started,false) "analysisStarted",
 COALESCE((SELECT
 x->>'currentRoundId'=r.id::text AND x->>'revoked'='false'
 AND (CASE WHEN x->>'requestMode'='Electronic' THEN x#>'{requestDocument,payload,draft}'=x->'draft' ELSE x#>>'{paperRequest,status}'='Verified' END)
 AND (CASE WHEN x->>'consentMode'='Electronic' THEN CASE
  WHEN x#>>'{caseFinalConsent,payload,signature,decision}'='Granted'
   AND x#>>'{caseFinalConsent,round_id}' IS NOT NULL
   AND x#>>'{caseFinalConsent,round_id}'<>r.id::text THEN true
  ELSE x#>>'{finalConsent,document_id}'=x#>>'{consentDocument,id}' AND x#>>'{finalConsent,payload,signature,decision}'='Granted' AND p2_consent_workspace_matches(x#>'{consentDocument,payload}',x->'draft',(x->>'workspaceVersion')::integer)
 END ELSE x->>'consentMode'='Paper' END)
 AND COALESCE(p2_consent_latest_decision(r.id),'')<>'Declined'
 FROM (SELECT p2_clinical_source(r.id) x) source),false) "documentsReady",
 (SELECT v.state FROM result_report_version v WHERE v.case_id=c.id AND v.round_id=r.id AND v.kind='RESULT' AND v.state NOT IN ('Superseded','Voided','RejectedImport') ORDER BY v.state_changed_at DESC,v.id DESC LIMIT 1) "reportState",
 (SELECT count(*)::int FROM result_release rr WHERE rr.case_id=c.id AND rr.round_id=r.id AND rr.kind='RESULT' AND rr.state='Active') "activeReleaseCount",
 (SELECT count(*)::int FROM result_release rr JOIN result_report_version v ON v.id=rr.version_id WHERE rr.case_id=c.id AND rr.round_id=r.id AND rr.kind='RESULT' AND rr.state='Active' AND v.state='CertifiedReleased' AND v.kind='RESULT' AND v.case_id=c.id AND v.round_id=r.id) "certifiedReleaseCount",
 EXISTS(SELECT 1 FROM p2_revocation v WHERE v.case_id=c.id) "consentRevoked",
 EXISTS(SELECT 1 FROM his_intake_issue i WHERE i.case_id=c.id AND i.state IN ('Open','Proposed')) "identityIssue",
 EXISTS(SELECT 1 FROM redraw_request d WHERE d.case_id=c.id AND d.state='Requested') redraw,
 EXISTS(SELECT 1 FROM repeat_work_order w WHERE w.case_id=c.id AND w.round_id=r.id AND w.state IN ('RepeatRequested','RepeatPendingBatch','RepeatInProgress')) repeat,
 COALESCE((SELECT e.event_type='HOLD_SET' FROM attempt_event e WHERE e.attempt_id=a.id AND e.event_type IN ('HOLD_SET','HOLD_RELEASED') ORDER BY e.sequence DESC LIMIT 1),false) hold,
 COALESCE((SELECT e.event_type='URGENT_SET' FROM attempt_event e WHERE e.attempt_id=a.id AND e.event_type IN ('URGENT_SET','URGENT_CLEARED') ORDER BY e.sequence DESC LIMIT 1),false) urgent
 FROM nipt_case c JOIN case_ln l ON l.case_id=c.id LEFT JOIN p2_case_identity i ON i.case_id=c.id
 ${currentPetPatientJoin}
 LEFT JOIN specimen_round r ON r.id=c.current_round_id AND r.case_id=c.id
 LEFT JOIN p2_workspace w ON w.case_id=c.id AND w.round_id=r.id
 LEFT JOIN LATERAL (
  SELECT NULLIF(btrim(older.draft#>>'{patient,syntheticName}'),'') AS name
  FROM p2_workspace older JOIN specimen_round older_round ON older_round.id=older.round_id
  WHERE older.case_id=c.id AND NULLIF(btrim(older.draft#>>'{patient,syntheticName}'),'') IS NOT NULL
  ORDER BY older_round.round_number DESC LIMIT 1
 ) patient_history ON true
 LEFT JOIN LATERAL(SELECT x.id FROM analytical_attempt x WHERE x.round_id=r.id AND x.state<>'Cancelled' ORDER BY x.attempt_number DESC LIMIT 1) a ON true
 WHERE c.registration_origin IN ('ANC','LAB_DIRECT') AND r.state IS DISTINCT FROM 'Cancelled'
 AND EXISTS(SELECT 1 FROM case_unit_scope s WHERE s.case_id=c.id AND s.unit_id=ANY($1::uuid[]))
 AND NOT EXISTS(SELECT 1 FROM p2_registration_void removed WHERE removed.case_id=c.id)`;

/** Port of project()/matches() (model.ts) to SQL so the queue is filtered, ordered, counted and paged by the database. model.ts stays the
 * reference definition: tests/db/anc-sql-parity.test.ts runs both over the same data. A change to a stage, flag or KPI rule must be made in BOTH. */
export const projectionFor=(facts:string,registrationOrder=false)=>`WITH facts AS MATERIALIZED (${facts}),
 rel AS (SELECT f.*,(f."currentReceivedAt" IS NOT NULL AND f."s1ReceivedAt" IS NULL) missing_s1,(f."activeReleaseCount">1 OR f."activeReleaseCount"<>f."certifiedReleaseCount") conflict FROM facts f),
 rel2 AS (SELECT r.*,(NOT r.missing_s1 AND NOT r.conflict AND r."certifiedReleaseCount"=1) released FROM rel r),
 st AS (SELECT r.*,CASE
   WHEN r.missing_s1 OR r.conflict OR r."currentRoundId" IS NULL THEN 'exception'
   WHEN r.released THEN 'released'
   WHEN r.redraw THEN 'followup'
   WHEN COALESCE(r."reportState",'') IN ('Linked','ValidationBlocked','PendingCertification') THEN 'review'
   WHEN r."analysisStarted" THEN 'analysis'
   WHEN COALESCE(r."roundState",'') IN ('ReceivedInHIS','ReceivedInNIPT','Completed') AND r."currentReceivedAt" IS NOT NULL THEN 'received'
   WHEN r."roundState"='Expected' THEN CASE WHEN r."documentsReady" THEN 'expected' ELSE 'documents' END
   ELSE 'exception' END stage FROM rel2 r),
 fl AS (SELECT s.*,
   array_remove(ARRAY[CASE WHEN s.redraw THEN 'redraw' END,CASE WHEN s.repeat THEN 'repeat' END,CASE WHEN s.hold THEN 'hold' END,CASE WHEN s.urgent THEN 'urgent' END,
    CASE WHEN s."consentRevoked" THEN 'consent_revoked' END,CASE WHEN s."identityIssue" THEN 'identity_issue' END,CASE WHEN NOT s."documentsReady" THEN 'documents' END,
    CASE WHEN s.missing_s1 THEN 'missing_s1' END,CASE WHEN s.conflict THEN 'conflicting_release' END,CASE WHEN s."reportState"='ValidationBlocked' THEN 'validation_blocked' END,
    CASE WHEN s.stage='exception' AND NOT s.missing_s1 AND NOT s.conflict THEN 'unmapped_state' END],NULL) flags,
   (s."s1ReceivedAt" IS NOT NULL AND NOT s.released) pending,
   CASE WHEN s."s1ReceivedAt" IS NOT NULL THEN GREATEST(0,floor(extract(epoch FROM ($2::timestamptz-s."s1ReceivedAt"))/86400))::int END days_waiting,
   COALESCE((extract(year FROM s."s1ReceivedAt" AT TIME ZONE 'Asia/Bangkok')::int+(extract(month FROM s."s1ReceivedAt" AT TIME ZONE 'Asia/Bangkok')>=10)::int+543)=$3::int,false) sent
  FROM st s),
 sc AS (SELECT * FROM fl WHERE ($4::text IS NULL OR $4::text=ANY("unitIds"))),
 flt AS (SELECT * FROM sc WHERE
   ($5::text IS NULL OR CASE $5::text WHEN 'sent' THEN sent WHEN 'pending' THEN pending WHEN 'released' THEN released WHEN 'attention' THEN cardinality(flags)>0 ELSE false END)
   AND ($6::text IS NULL OR stage=$6::text) AND ($7::text IS NULL OR $7::text=ANY(flags))
   AND ($9::text='' OR strpos(lower(ln),$9::text)>0 OR strpos(lower(COALESCE(hn,'')),$9::text)>0 OR strpos(lower(id::text),$9::text)>0 OR strpos(lower(COALESCE("patientName",'')),$9::text)>0 OR ($9::text ~ '^[0-9]{2}-[0-9]{3}-[0-9]-[0-9]{4}$' AND strpos(ln,replace($9::text,'-',''))>0)))
 , tabbed AS (SELECT * FROM flt WHERE ($8::text='all' OR CASE $8::text WHEN 'redraw' THEN redraw WHEN 'hold' THEN hold WHEN 'pending' THEN pending WHEN 'released' THEN released WHEN 'attention' THEN cardinality(flags)>0 ELSE false END)),
 ordered AS (SELECT *,${registrationOrder?'0':'urgent::int'} ord_u,${registrationOrder?'floor(extract(epoch FROM "registeredAt")*1000000)::bigint':'COALESCE(days_waiting,-1)'} ord_d FROM tabbed)
 SELECT
  (SELECT json_build_object('all',count(*),'pending',count(*) FILTER(WHERE pending),'released',count(*) FILTER(WHERE released),'attention',count(*) FILTER(WHERE cardinality(flags)>0),'redraw',count(*) FILTER(WHERE redraw),'hold',count(*) FILTER(WHERE hold)) FROM flt) tab_counts,
  (SELECT json_build_object('sent',count(*) FILTER (WHERE sent),'pending',count(*) FILTER (WHERE pending),'released',count(*) FILTER (WHERE released),'attention',count(*) FILTER (WHERE cardinality(flags)>0)) FROM sc) metrics,
  (SELECT COALESCE(json_object_agg(stage,n),'{}'::json) FROM (SELECT stage,count(*)::int n FROM sc GROUP BY stage) x) stage_counts,
  (SELECT count(*)::int FROM tabbed) total,
  (SELECT COALESCE(json_agg(row_to_json(p) ORDER BY p.ord_u DESC,p.ord_d DESC,p.id),'[]'::json) FROM (
    SELECT id,ln,hn,"patientName","unitIds","currentRoundId","roundNumber","roundState","s1ReceivedAt","currentReceivedAt","analysisStarted","documentsReady","reportState","activeReleaseCount","certifiedReleaseCount",
     redraw,repeat,hold,urgent,"consentRevoked","identityIssue",stage,flags,released,pending,days_waiting "daysWaiting",ord_u,ord_d
    FROM ordered WHERE ($10::int IS NULL OR (ord_u<$10::int OR (ord_u=$10::int AND ord_d<$11::bigint) OR (ord_u=$10::int AND ord_d=$11::bigint AND id>$12::uuid)))
    ORDER BY ord_u DESC,ord_d DESC,id LIMIT $13 OFFSET $14) p) rows`;
const projectionSql=projectionFor(factsSql,true);
type SqlRow=Omit<QueueItem,'stageLabel'|'s1ReceivedAt'|'currentReceivedAt'>&{s1ReceivedAt:string|null;currentReceivedAt:string|null;ord_u:number;ord_d:number};
const SIX_HOURS=6*3600000;
export type ProjectionInput={unitIds:string[];asOf:Date;fy:number;unitId?:string;kpi?:string;stage?:string;flag?:string;tab:string;q:string;cursor:Cursor|null;limit:number;offset:number};
export type ProjectionResult={tab_counts:NonNullable<Dashboard['queue']['tabCounts']>;metrics:Dashboard['metrics'];stage_counts:Record<string,number>;total:number;rows:SqlRow[]};
/** The one place parameter order is defined (also used by the parity test with a fixture in place of the facts query). */
export async function runProjection(db:Queryable,sql:string,i:ProjectionInput):Promise<ProjectionResult>{
 return (await db.query<ProjectionResult>(sql,[i.unitIds,i.asOf.toISOString(),i.fy,i.unitId??null,i.kpi??null,i.stage??null,i.flag??null,i.tab,i.q.trim().toLowerCase(),i.cursor?.u??null,i.cursor?.d??null,i.cursor?.id??null,i.limit,i.offset])).rows[0];
}
export async function dashboard(db:Queryable,user:Staff,input:unknown={}):Promise<Dashboard> {
 await assertSession(db,user);
 if(!user.roles.some(role=>role==='ANC_NURSE'||role==='ANC_SUPERVISOR'||role==='APP_ADMIN'))throw new LabError('FORBIDDEN',403);
 const f=filterSchema.parse(input);
 // A scope probe is safe: policy needs a unit for U cells; it does not invent a new permission.
 if(!authorize(user,'case.read',{unitId:user.unitIds[0]??'scope-probe',origin:'ANC'},'read')&&!user.unitIds.some(id=>authorize(user,'case.read',{unitId:id,origin:'ANC'},'read')))throw new LabError('FORBIDDEN',403);
 const units=(await db.query<{id:string;name:string}>('SELECT id,name FROM unit ORDER BY name,id')).rows.filter(u=>authorize(user,'case.read',{unitId:u.id,origin:'ANC'},'read')&&authorize(user,'result.read.released',{unitId:u.id,origin:'ANC'},'read'));
 if(f.unitId&&!units.some(u=>u.id===f.unitId))throw new LabError('FORBIDDEN',403);
 const now=(await db.query<{now:Date|string}>('SELECT CURRENT_TIMESTAMP AS now')).rows[0].now;
 const date=new Date(now),fy=f.fy??fiscalYear(date.toISOString());
 // Pin "now" to the first page's time while someone is paging (never in the future, never older than six hours).
 const asOfMs=f.asOf?Date.parse(f.asOf):NaN,asOf=Number.isFinite(asOfMs)&&asOfMs<=date.getTime()&&date.getTime()-asOfMs<=SIX_HOURS?new Date(asOfMs):date;
 const unitIds=units.map(u=>u.id);
 const cursor=f.after?decodeCursor(f.after):null;
 const run=(offset:number)=>runProjection(db,projectionSql,{unitIds,asOf,fy,unitId:f.unitId,kpi:f.kpi,stage:f.stage,flag:f.flag,tab:f.tab??'all',q:f.q??'',cursor,limit:f.pageSize,offset});
 let page=f.page,out=await run(cursor?0:(page-1)*f.pageSize);
 const totalPages=Math.max(1,Math.ceil(out.total/f.pageSize));
 // A page past the end (rows left the queue since the last response) answers with the last real page instead of an empty one.
 if(!cursor&&page>totalPages){page=totalPages;out=await run((page-1)*f.pageSize);}
 const items:QueueItem[]=out.rows.map(row=>{const c:Partial<SqlRow>={...row};delete c.ord_u;delete c.ord_d;return c as Omit<SqlRow,'ord_u'|'ord_d'>;}).map(c=>({...c,s1ReceivedAt:c.s1ReceivedAt?new Date(c.s1ReceivedAt).toISOString():null,currentReceivedAt:c.currentReceivedAt?new Date(c.currentReceivedAt).toISOString():null,stageLabel:stages.find(s=>s[0]===c.stage)![1]}));
 const last=out.rows.at(-1);
 // Following a cursor the position in the list is not known from `page`, so "is there more" is: this page is full and the cursor query found it so.
 const more=cursor?items.length===f.pageSize:(page-1)*f.pageSize+items.length<out.total;
 return {fiscalYear:fy,generatedAt:date.toISOString(),asOf:asOf.toISOString(),scope:{unitIds,allUnits:user.roles.includes('APP_ADMIN')||user.permissions.includes('ANC_VIEW_ALL_UNITS')},metrics:out.metrics,stages:stages.map(([id,label])=>({id,label,count:out.stage_counts[id]??0})),queue:{tabCounts:out.tab_counts,items,total:out.total,page,pageSize:f.pageSize,totalPages,nextCursor:more&&last?encodeCursor({u:last.ord_u as 0|1,d:last.ord_d,id:last.id}):null},units,limitations:['เอกสารครบหมายถึงมีหลักฐาน Request และ Consent ยินยอม ไม่ใช่การรับรองเกณฑ์คลินิก','รายการรอผลรวมเคสที่รับ S1 ทุกปี ไม่รวมข้อมูลย้อนหลังและรอบปัจจุบันที่ยกเลิก']};
}
