import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {PAGE_SIZES,clampPage,offsetOf} from '../db/pagination';
import {authorize,type Principal} from '../security/policy';
import {ACTIONS_BY_KIND} from './resolution';
import type {IssueKind} from './process';

/** LN is shown to Lab/Certifier/Auditor (intake.link) and, per OWNER-LAB-022, to APP_ADMIN / IT_OPERATOR who run the HIS
 *  interface. HIS name/HN/DOB values are still never read here (blind entry); other roles see a masked LN. */
export const canSeeLn=(user:Principal)=>(['propose','approve','read'] as const).some(op=>authorize(user,'intake.link',{},op))||user.roles.some(r=>r==='APP_ADMIN'||r==='IT_OPERATOR');
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

// ── Paged read used by /inbound ─────────────────────────────────────────────────────────────────────────────────────────────────────
// The page used to show the oldest 300 open issues and the newest 300 files and nothing beyond; an issue past that was unreachable. Each list
// now pages on its own with an exact total. Order is unchanged: issues oldest first (the Workflow's priority), files newest first.
export type InboundPageInput={issuesPage?:unknown;unlinkedPage?:unknown;filesPage?:unknown;closedFilesPage?:unknown;pageSize?:unknown;q?:unknown};
const inboundInput=z.strictObject({issuesPage:z.coerce.number().int().min(1).max(1000000).default(1),unlinkedPage:z.coerce.number().int().min(1).max(1000000).default(1),filesPage:z.coerce.number().int().min(1).max(1000000).default(1),closedFilesPage:z.coerce.number().int().min(1).max(1000000).default(1),runsPage:z.coerce.number().int().min(1).max(1000000).default(1),
 q:z.string().trim().max(40).default(''),pageSize:z.coerce.number().int().refine(v=>PAGE_SIZES.includes(v as 25),'PAGE_SIZE_INVALID').default(25)});
const WAITING_SHOWN=50;
export async function inboundQueuePage(db:Queryable,user:Principal,raw:unknown={}){
 const f=inboundInput.parse(raw),show=canSeeLn(user),ln=(v:string|null)=>v===null?null:show?v:maskLn(v);
 // LN search only for roles that may see LN; for the others the LN is masked, so searching it would reveal it.
 const q=show?f.q.toLowerCase():'';
 const issueGroup=async(group:'review'|'unlinked',requested:number)=>{
  const where=`i.state IN ('Open','Proposed') AND i.kind${group==='review'?'<>':'='}'UNLINKED'${q?' AND strpos(lower(i.ln),$1)>0':''}`,values=q?[q]:[];
  const total=Number((await db.query<{n:string}>(`SELECT count(*)::text n FROM his_intake_issue i WHERE ${where}`,values)).rows[0].n),meta=clampPage(requested,total,f.pageSize);
  const rows=(await db.query<{id:string;ln:string;kind:IssueKind;state:string;details:{fields?:string[]};created_at:Date;case_id:string|null;proposed_action:string|null;proposed_by:string|null;proposed_case:string|null}>(
   `SELECT i.id,i.ln,i.kind,i.state,i.details,i.created_at,i.case_id,p.action AS proposed_action,p.actor_id AS proposed_by,p.case_id AS proposed_case
    FROM his_intake_issue i LEFT JOIN LATERAL (SELECT action,actor_id,case_id FROM his_intake_issue_event e WHERE e.issue_id=i.id AND e.event='PROPOSED' ORDER BY sequence DESC LIMIT 1) p ON i.state='Proposed'
    WHERE ${where} ORDER BY i.created_at,i.id LIMIT ${meta.size} OFFSET ${offsetOf(meta)}`,values)).rows;
  return {rows:rows.map(i=>({id:i.id,ln:ln(i.ln),kind:i.kind,state:i.state,fields:i.details?.fields??[],createdAt:i.created_at,caseId:show?i.case_id:null,allowedActions:ACTIONS_BY_KIND[i.kind],proposal:i.proposed_action?{action:i.proposed_action,caseId:show?i.proposed_case:null,byCurrentUser:i.proposed_by===user.id}:null})),page:meta};
 };
 const latestFileEvent=`(SELECT e.event FROM his_inbound_file_event e WHERE e.inbound_file_id=f.id ORDER BY e.sequence DESC LIMIT 1)`;
 const fileSearch=q?' AND strpos(lower(f.ln),$1)>0':'';
 const fileWhere=`f.source_path IS NOT NULL AND COALESCE(${latestFileEvent},'') NOT IN ('DISMISSED','SUPERSEDED')${fileSearch}`;
 const closedFileWhere=`f.source_path IS NOT NULL AND ${latestFileEvent} IN ('DISMISSED','SUPERSEDED')${fileSearch}`;
 const fileValues=q?[q]:[];
 const fileTotal=Number((await db.query<{n:string}>(`SELECT count(*)::text n FROM his_inbound_file f WHERE ${fileWhere}`,fileValues)).rows[0].n),fileMeta=clampPage(f.filesPage,fileTotal,f.pageSize);
 const closedFileTotal=Number((await db.query<{n:string}>(`SELECT count(*)::text n FROM his_inbound_file f WHERE ${closedFileWhere}`,fileValues)).rows[0].n),closedFileMeta=clampPage(f.closedFilesPage,closedFileTotal,f.pageSize);
 // OWNER-LAB-019: scan history is paged (25/50/100) with a stable order instead of a fixed last-10 list.
 const runTotal=Number((await db.query<{n:string}>('SELECT count(*)::text n FROM his_inbound_scan_run')).rows[0].n),runMeta=clampPage(f.runsPage,runTotal,f.pageSize);
 const [review,unlinked,files,closedFiles,runs,waiting,waitingTotal]=await Promise.all([
  issueGroup('review',f.issuesPage),issueGroup('unlinked',f.unlinkedPage),
  db.query<{id:string;ln:string|null;state:string;error_code:string|null;source_path:string|null;path_version:number|null;discovered_at:Date;processed_at:Date|null;linked:boolean}>(
   `SELECT f.id,f.ln,f.state,f.error_code,f.source_path,f.path_version,f.discovered_at,f.processed_at,f.case_id IS NOT NULL AS linked FROM his_inbound_file f WHERE ${fileWhere} ORDER BY f.discovered_at DESC,f.id DESC LIMIT ${fileMeta.size} OFFSET ${offsetOf(fileMeta)}`,fileValues),
  db.query<{id:string;ln:string|null;state:string;error_code:string|null;source_path:string|null;path_version:number|null;discovered_at:Date;review_event:string;review_actor:string|null;review_at:Date;review_actor_name:string|null}>(
   `SELECT f.id,f.ln,f.state,f.error_code,f.source_path,f.path_version,f.discovered_at,r.event AS review_event,r.actor_id AS review_actor,r.created_at AS review_at,u.display_name AS review_actor_name
    FROM his_inbound_file f JOIN LATERAL (SELECT e.event,e.actor_id,e.created_at FROM his_inbound_file_event e WHERE e.inbound_file_id=f.id ORDER BY e.sequence DESC LIMIT 1) r ON r.event IN ('DISMISSED','SUPERSEDED')
    LEFT JOIN app_user u ON u.id=r.actor_id WHERE ${closedFileWhere} ORDER BY r.created_at DESC,f.discovered_at DESC,f.id DESC LIMIT ${closedFileMeta.size} OFFSET ${offsetOf(closedFileMeta)}`,fileValues),
  db.query<{id:string;trigger:string;outcome:string;started_at:Date;finished_at:Date;counts:Record<string,number>;error_code:string|null}>(`SELECT id,trigger,outcome,started_at,finished_at,counts,error_code FROM his_inbound_scan_run ORDER BY finished_at DESC,id DESC LIMIT ${runMeta.size} OFFSET ${offsetOf(runMeta)}`),
  db.query<{source_path:string;first_seen_at:Date}>(`SELECT source_path,first_seen_at FROM his_inbound_waiting WHERE ok_seen_at IS NULL ORDER BY first_seen_at,source_path LIMIT ${WAITING_SHOWN}`),
  db.query<{n:string}>('SELECT count(*)::text n FROM his_inbound_waiting WHERE ok_seen_at IS NULL')]);
 return {
  review,unlinked,
  files:{rows:files.rows.map(x=>({id:x.id,ln:ln(x.ln),state:x.state,errorCode:x.error_code,dayFolder:x.source_path?.split('/')[1]??null,pathVersion:x.path_version,discoveredAt:x.discovered_at,processedAt:x.processed_at,linked:x.linked})),page:fileMeta},
  closedFiles:{rows:closedFiles.rows.map(x=>({id:x.id,ln:ln(x.ln),state:x.state,errorCode:x.error_code,dayFolder:x.source_path?.split('/')[1]??null,pathVersion:x.path_version,discoveredAt:x.discovered_at,reviewEvent:x.review_event,reviewActor:x.review_actor,reviewAt:x.review_at,reviewActorName:x.review_actor_name})),page:closedFileMeta},
  runs:{rows:runs.rows.map(r=>({id:r.id,trigger:r.trigger,outcome:r.outcome,startedAt:r.started_at,finishedAt:r.finished_at,counts:r.counts,errorCode:r.error_code})),page:runMeta},
  waiting:{rows:waiting.rows.map(w=>({dayFolder:w.source_path.split('/')[1],ln:ln(w.source_path.split('/')[2].split('-')[0]),firstSeenAt:w.first_seen_at})),total:Number(waitingTotal.rows[0].n),shown:WAITING_SHOWN},
  search:{q:f.q,enabled:show}
 };
}
