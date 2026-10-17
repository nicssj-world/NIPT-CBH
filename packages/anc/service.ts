import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {assertSession,LabError,type Staff} from '../lab/core';
import {authorize} from '../security/policy';
import {fiscalYear,flagLabels,matches,project,stages,type CaseFacts,type Dashboard} from './model';

export const filterSchema=z.object({fy:z.coerce.number().int().min(2543).max(2743).optional(),unitId:z.uuid().optional(),kpi:z.enum(['sent','pending','released','attention']).optional(),stage:z.enum(stages.map(s=>s[0])).optional(),flag:z.enum(Object.keys(flagLabels) as [keyof typeof flagLabels,...(keyof typeof flagLabels)[]]).optional(),tab:z.enum(['all','pending','released','attention','redraw','hold']).optional(),q:z.string().trim().max(100).optional(),page:z.coerce.number().int().min(1).max(1000000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20)}).strict();

/** ANC roles need both case.read and result.read.released for each unit before facts are read.
 * EXISTS and scalar subqueries keep exactly one row per case, even for multiple unit scopes.
 * Documents use the authoritative p2_clinical_source and document portion of migration 088's
 * readiness predicate. Collection-date/clinical-review gates remain separate from document readiness. */
export const factsSql=`SELECT c.id,l.ln,i.hn,
 ARRAY(SELECT s.unit_id::text FROM case_unit_scope s WHERE s.case_id=c.id AND s.unit_id=ANY($1::uuid[]) ORDER BY s.unit_id) "unitIds",
 c.current_round_id "currentRoundId",r.round_number "roundNumber",r.state "roundState",
 (SELECT s.received_at FROM specimen_round s WHERE s.case_id=c.id AND s.round_number=1) "s1ReceivedAt",r.received_at "currentReceivedAt",COALESCE(r.analysis_started,false) "analysisStarted",
 COALESCE((SELECT
 x->>'currentRoundId'=r.id::text AND x->>'revoked'='false'
 AND (CASE WHEN x->>'requestMode'='Electronic' THEN x#>'{requestDocument,payload,draft}'=x->'draft' ELSE x#>>'{paperRequest,status}'='Verified' END)
 AND (CASE WHEN x->>'consentMode'='Electronic' THEN x#>>'{finalConsent,document_id}'=x#>>'{consentDocument,id}' AND x#>>'{finalConsent,payload,signature,decision}'='Granted' AND x#>'{consentDocument,payload,workspaceVersion}'=x->'workspaceVersion'
 ELSE x#>>'{paperConsent,status}'='Verified' AND x#>>'{paperConsent,panel,decision}'='Granted' END)
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
 LEFT JOIN specimen_round r ON r.id=c.current_round_id AND r.case_id=c.id
 LEFT JOIN LATERAL(SELECT x.id FROM analytical_attempt x WHERE x.round_id=r.id AND x.state<>'Cancelled' ORDER BY x.attempt_number DESC LIMIT 1) a ON true
 WHERE c.registration_origin IN ('ANC','LAB_DIRECT') AND r.state IS DISTINCT FROM 'Cancelled'
 AND EXISTS(SELECT 1 FROM case_unit_scope s WHERE s.case_id=c.id AND s.unit_id=ANY($1::uuid[]))`;

export async function dashboard(db:Queryable,user:Staff,input:unknown={}):Promise<Dashboard> {
 await assertSession(db,user);
 if(!user.roles.some(role=>role==='ANC_NURSE'||role==='ANC_SUPERVISOR'))throw new LabError('FORBIDDEN',403);
 const f=filterSchema.parse(input);
 // A scope probe is safe: policy needs a unit for U cells; it does not invent a new permission.
 if(!authorize(user,'case.read',{unitId:user.unitIds[0]??'scope-probe',origin:'ANC'},'read')&&!user.unitIds.some(id=>authorize(user,'case.read',{unitId:id,origin:'ANC'},'read')))throw new LabError('FORBIDDEN',403);
 const units=(await db.query<{id:string;name:string}>('SELECT id,name FROM unit ORDER BY name,id')).rows.filter(u=>authorize(user,'case.read',{unitId:u.id,origin:'ANC'},'read')&&authorize(user,'result.read.released',{unitId:u.id,origin:'ANC'},'read'));
 if(f.unitId&&!units.some(u=>u.id===f.unitId))throw new LabError('FORBIDDEN',403);
 const now=(await db.query<{now:Date|string}>('SELECT CURRENT_TIMESTAMP AS now')).rows[0].now;
 const date=new Date(now),fy=f.fy??fiscalYear(date.toISOString());
 const unitIds=units.map(u=>u.id);
 const facts=(await db.query<CaseFacts>(factsSql,[unitIds])).rows;
 const items=facts.map(c=>project({...c,s1ReceivedAt:c.s1ReceivedAt?new Date(c.s1ReceivedAt).toISOString():null,currentReceivedAt:c.currentReceivedAt?new Date(c.currentReceivedAt).toISOString():null},date));
 const scoped=items.filter(c=>matches(c,{unitId:f.unitId}));
 const metrics=Object.fromEntries((['sent','pending','released','attention'] as const).map(k=>[k,scoped.filter(c=>matches(c,{kpi:k,fy})).length])) as Dashboard['metrics'];
 const queue=scoped.filter(c=>matches(c,{...f,fy})).sort((a,b)=>Number(b.urgent)-Number(a.urgent)||(b.daysWaiting??-1)-(a.daysWaiting??-1)||a.id.localeCompare(b.id));
 return {fiscalYear:fy,generatedAt:date.toISOString(),scope:{unitIds,allUnits:user.permissions.includes('ANC_VIEW_ALL_UNITS')},metrics,stages:stages.map(([id,label])=>({id,label,count:scoped.filter(c=>c.stage===id).length})),queue:{items:queue.slice((f.page-1)*f.pageSize,f.page*f.pageSize),total:queue.length,page:f.page,pageSize:f.pageSize},units,limitations:['เอกสารครบหมายถึงมีหลักฐาน Request และ Consent ยินยอม ไม่ใช่การรับรองเกณฑ์คลินิก','รายการรอผลรวมเคสที่รับ S1 ทุกปี ไม่รวมข้อมูลย้อนหลังและรอบปัจจุบันที่ยกเลิก']};
}
