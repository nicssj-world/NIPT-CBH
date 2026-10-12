import type {Queryable} from '../db/connection';
import {authorize,type Principal} from '../security/policy';
import {ACTIONS_BY_KIND} from './resolution';
import type {IssueKind} from './process';

/** LN is shown to Lab/Certifier/Auditor (intake.link); Admin/IT see a masked LN (Plan §7.2 "ไม่เห็น PHI"). */
export const canSeeLn=(user:Principal)=>(['propose','approve','read'] as const).some(op=>authorize(user,'intake.link',{},op));
export const maskLn=(ln:string)=>'••••'+ln.slice(-4);

/**
 * Operational projection only: states, error codes, issue kinds and differing field NAMES. It never reads
 * `parsed`, so no HIS name/HN/DOB/identity value can reach the page (blind entry, R-50).
 */
export async function inboundQueue(db:Queryable,user:Principal,limit=100){
 const show=canSeeLn(user),ln=(v:string|null)=>v===null?null:show?v:maskLn(v);
 const [files,issues,runs,waiting]=await Promise.all([
  db.query<{id:string;ln:string|null;state:string;error_code:string|null;source_path:string|null;path_version:number|null;discovered_at:Date;processed_at:Date|null;linked:boolean}>("SELECT id,ln,state,error_code,source_path,path_version,discovered_at,processed_at,case_id IS NOT NULL AS linked FROM his_inbound_file WHERE source_path IS NOT NULL ORDER BY discovered_at DESC LIMIT $1",[limit]),
  db.query<{id:string;ln:string;kind:IssueKind;state:string;details:{fields?:string[]};created_at:Date;case_id:string|null;proposed_action:string|null;proposed_by:string|null;proposed_case:string|null}>(`SELECT i.id,i.ln,i.kind,i.state,i.details,i.created_at,i.case_id,p.action AS proposed_action,p.actor_id AS proposed_by,p.case_id AS proposed_case
   FROM his_intake_issue i LEFT JOIN LATERAL (SELECT action,actor_id,case_id FROM his_intake_issue_event e WHERE e.issue_id=i.id AND e.event='PROPOSED' ORDER BY sequence DESC LIMIT 1) p ON i.state='Proposed'
   WHERE i.state IN ('Open','Proposed') ORDER BY i.created_at LIMIT $1`,[limit]),
  db.query<{id:string;trigger:string;outcome:string;started_at:Date;finished_at:Date;counts:Record<string,number>;error_code:string|null}>('SELECT id,trigger,outcome,started_at,finished_at,counts,error_code FROM his_inbound_scan_run ORDER BY finished_at DESC LIMIT 10'),
  db.query<{source_path:string;first_seen_at:Date}>('SELECT source_path,first_seen_at FROM his_inbound_waiting WHERE ok_seen_at IS NULL ORDER BY first_seen_at LIMIT 50')
 ]);
 return {
  files:files.rows.map(f=>({id:f.id,ln:ln(f.ln),state:f.state,errorCode:f.error_code,dayFolder:f.source_path?.split('/')[1]??null,pathVersion:f.path_version,discoveredAt:f.discovered_at,processedAt:f.processed_at,linked:f.linked})),
  issues:issues.rows.map(i=>({id:i.id,ln:ln(i.ln),kind:i.kind,state:i.state,fields:i.details?.fields??[],createdAt:i.created_at,caseId:show?i.case_id:null,allowedActions:ACTIONS_BY_KIND[i.kind],proposal:i.proposed_action?{action:i.proposed_action,caseId:show?i.proposed_case:null,byCurrentUser:i.proposed_by===user.id}:null})),
  runs:runs.rows.map(r=>({id:r.id,trigger:r.trigger,outcome:r.outcome,startedAt:r.started_at,finishedAt:r.finished_at,counts:r.counts,errorCode:r.error_code})),
  waiting:waiting.rows.map(w=>({dayFolder:w.source_path.split('/')[1],ln:ln(w.source_path.split('/')[2].split('-')[0]),firstSeenAt:w.first_seen_at}))
 };
}
