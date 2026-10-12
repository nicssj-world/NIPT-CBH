import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {lockLn} from '../db/registration';
import {appendAudit} from '../db/audit';
import {authorize,type Principal} from '../security/policy';
import {applyS1,lockedTarget,readPet,type InboundDeps,type IssueKind} from './process';

export const RESOLUTION_ACTIONS=['link_case','keep_existing','acknowledge','dismiss'] as const;
export type ResolutionAction=typeof RESOLUTION_ACTIONS[number];
/**
 * Plan §5.5 resolutions available without P2 registration services. `accept_his`, `create_case` and `new_generation`
 * need P2 identity/registration writes and stay unavailable until integration (docs/p3-synthetic-delivery.md).
 */
export const ACTIONS_BY_KIND:Record<IssueKind,readonly ResolutionAction[]>={
 UNLINKED:['link_case','dismiss'],IDENTITY_MISMATCH:['link_case','dismiss'],IDENTITY_UNVERIFIED:['link_case','dismiss'],
 LN_REUSED_OR_CHANGED:['keep_existing'],LN_REUSED_DIFFERENT_PATIENT:['keep_existing'],S1_INTEGRITY_EVENT:['acknowledge'],HISTORICAL_LN_INTAKE:['acknowledge']
};
export const resolutionInput=z.strictObject({action:z.enum(RESOLUTION_ACTIONS),caseId:z.uuid().nullable().optional(),reason:z.string().trim().min(8).max(500)});
export class ResolutionError extends Error{constructor(code:string,public status=409){super(code);}}
type Issue={id:string;inbound_file_id:string;ln:string;kind:IssueKind;case_id:string|null;state:string};

async function lockIssue(db:Queryable,issueId:string){
 z.uuid().parse(issueId);
 const head=(await db.query<{ln:string}>('SELECT ln FROM his_intake_issue WHERE id=$1',[issueId])).rows[0];if(!head)throw new ResolutionError('ISSUE_NOT_FOUND',404);
 await lockLn(db,head.ln);
 return (await db.query<Issue>('SELECT id,inbound_file_id,ln,kind,case_id,state FROM his_intake_issue WHERE id=$1 FOR UPDATE',[issueId])).rows[0];
}
function validate(issue:Issue,action:ResolutionAction,caseId:string|null){
 if(!ACTIONS_BY_KIND[issue.kind].includes(action))throw new ResolutionError('ACTION_NOT_ALLOWED_FOR_ISSUE',422);
 if(action==='link_case'&&!caseId)throw new ResolutionError('CASE_REQUIRED',422);
 if(action!=='link_case'&&caseId)throw new ResolutionError('CASE_NOT_APPLICABLE',422);
}

/** Step 1 (Lab staff, "P"): record a proposed resolution with reason. Does not change any clinical record. */
export async function proposeResolution(db:Queryable,user:Principal,issueId:string,input:unknown){
 const d=resolutionInput.parse(input),caseId=d.caseId??null;
 if(!authorize(user,'his.conflict.resolve',{},'propose'))throw new ResolutionError('FORBIDDEN',403);
 const issue=await lockIssue(db,issueId);if(issue.state!=='Open')throw new ResolutionError('ISSUE_NOT_OPEN');
 validate(issue,d.action,caseId);
 await db.query("INSERT INTO his_intake_issue_event(issue_id,event,action,case_id,actor_id,reason) VALUES($1,'PROPOSED',$2,$3,$4,$5)",[issue.id,d.action,caseId,user.id,d.reason]);
 await db.query("UPDATE his_intake_issue SET state='Proposed' WHERE id=$1",[issue.id]);
 await appendAudit(db,{actorId:user.id,action:'INBOUND_RESOLUTION_PROPOSED',resourceType:'his_intake_issue',resourceId:issue.id,details:{outcome:d.action,reasonCode:issue.kind,synthetic:true}});
 return {state:'Proposed'};
}

/** Step 2 (Certifier, "A", different person): approve executes the proposal; reject reopens the issue. */
export async function decideResolution(db:Queryable,user:Principal,issueId:string,input:unknown,deps:InboundDeps){
 const d=z.strictObject({decision:z.enum(['APPROVED','REJECTED']),reason:z.string().trim().min(8).max(500)}).parse(input);
 const issue=await lockIssue(db,issueId);if(issue.state!=='Proposed')throw new ResolutionError('ISSUE_NOT_PROPOSED');
 const proposal=(await db.query<{action:ResolutionAction;case_id:string|null;actor_id:string}>("SELECT action,case_id,actor_id FROM his_intake_issue_event WHERE issue_id=$1 AND event='PROPOSED' ORDER BY sequence DESC LIMIT 1",[issue.id])).rows[0];
 if(!proposal)throw new ResolutionError('RESOLUTION_PROPOSAL_REQUIRED');
 if(!authorize(user,'his.conflict.resolve',{actorId:proposal.actor_id},'approve'))throw new ResolutionError(proposal.actor_id===user.id?'SECOND_PERSON_REQUIRED':'FORBIDDEN',403);
 await db.query('INSERT INTO his_intake_issue_event(issue_id,event,action,case_id,actor_id,reason) VALUES($1,$2,$3,$4,$5,$6)',[issue.id,d.decision,d.decision==='APPROVED'?proposal.action:null,d.decision==='APPROVED'?proposal.case_id:null,user.id,d.reason]);
 if(d.decision==='REJECTED'){
  await db.query("UPDATE his_intake_issue SET state='Open' WHERE id=$1",[issue.id]);
  await appendAudit(db,{actorId:user.id,action:'INBOUND_RESOLUTION_REJECTED',resourceType:'his_intake_issue',resourceId:issue.id,details:{outcome:proposal.action,reasonCode:issue.kind,synthetic:true}});
  return {state:'Open'};
 }
 // Close this issue first so the link below cannot auto-close it; any failure rolls the whole decision back.
 await db.query("UPDATE his_intake_issue SET state='Resolved',closed_at=now(),case_id=COALESCE(case_id,$2) WHERE id=$1",[issue.id,proposal.case_id]);
 if(proposal.action==='link_case')await linkCase(db,issue,proposal.case_id!,user.id,deps);
 await appendAudit(db,{actorId:user.id,action:'INBOUND_RESOLUTION_APPROVED',resourceType:'his_intake_issue',resourceId:issue.id,details:{outcome:proposal.action,reasonCode:issue.kind,synthetic:true}});
 return {state:'Resolved'};
}

/** Manual linkage (D-18): same LN only, S1 not yet received, never HISTORICAL. LN correction belongs to P2 registration. */
async function linkCase(db:Queryable,issue:Issue,caseId:string,actorId:string,deps:InboundDeps){
 const file=(await db.query<{id:string;sha256:string;filename:string;ln:string;state:string}>('SELECT id,sha256,filename,ln,state FROM his_inbound_file WHERE id=$1 FOR UPDATE',[issue.inbound_file_id])).rows[0];
 if(!file||file.state!=='Unlinked')throw new ResolutionError('INTAKE_NOT_UNLINKED');
 const target=await lockedTarget(db,issue.ln);
 if(!target||target.case_id!==caseId)throw new ResolutionError('CASE_LN_MISMATCH',422);
 if(target.origin==='HISTORICAL')throw new ResolutionError('HISTORICAL_LINK_PROHIBITED',422);
 if((await db.query('SELECT 1 FROM his_order WHERE case_ln_id=$1',[target.case_ln_id])).rows.length)throw new ResolutionError('S1_ALREADY_RECEIVED');
 // Other open identity issues of the same intake are superseded by this two-person decision.
 const others=await db.query<{id:string}>("UPDATE his_intake_issue SET state='AutoClosed',closed_at=now() WHERE inbound_file_id=$1 AND id<>$2 AND state IN ('Open','Proposed') RETURNING id",[file.id,issue.id]);
 for(const o of others.rows)await db.query("INSERT INTO his_intake_issue_event(issue_id,event,details) VALUES($1,'AUTO_CLOSED',$2)",[o.id,JSON.stringify({reasonCode:'TWO_PERSON_LINK'})]);
 await applyS1(db,file,await readPet(deps.store,file),target,'TWO_PERSON',actorId);
}
