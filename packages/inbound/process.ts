import type {Queryable} from '../db/connection';
import type {FileStore} from '../storage';
import {parsePet,type Pet} from '../integrations/pet';
import {lockLn} from '../db/registration';
import {appendAudit} from '../db/audit';
import {petDifferences} from './wire';
import {compareRegistrant,defaultIdentitySource,type RegistrantIdentitySource} from './identity';
import {transactional,errorCode} from './tx';

export const ISSUE_KINDS=['IDENTITY_MISMATCH','LN_REUSED_OR_CHANGED','LN_REUSED_DIFFERENT_PATIENT','UNLINKED','IDENTITY_UNVERIFIED','S1_INTEGRITY_EVENT','HISTORICAL_LN_INTAKE'] as const;
export type IssueKind=typeof ISSUE_KINDS[number];
export type ProcessOutcome='APPLIED_S1'|'APPLIED_REDRAW'|'DUPLICATE'|'SKIPPED'|IssueKind;
export interface InboundDeps{store:FileStore;lookupKey:Buffer;identity?:RegistrantIdentitySource;}
/**
 * Registration-time evaluation (D-49). Identity is never supplied by the caller: the same stored P2 registrant identity
 * the worker uses is read inside the registration transaction, so the outcome cannot depend on who evaluates first.
 */
export interface RegistrationContext{via:'REGISTRATION';actorId:string;}
type FileRow={id:string;sha256:string;state:string;ln:string;filename:string};
type Target={case_ln_id:string;case_id:string;origin:'ANC'|'LAB_DIRECT'|'HISTORICAL'};
const json=(v:unknown)=>JSON.stringify(v);

async function setState(db:Queryable,id:string,state:string,caseId:string|null){
 await db.query('UPDATE his_inbound_file SET state=$2,case_id=COALESCE($3,case_id),processed_at=now(),error_code=NULL WHERE id=$1',[id,state,caseId]);
}
async function caseEvent(db:Queryable,caseId:string,type:string,details:Record<string,unknown>){
 await db.query('INSERT INTO case_event(case_id,event_type,details) VALUES($1,$2,$3)',[caseId,type,json({...details,synthetic:true})]);
}
export async function openIssue(db:Queryable,file:{id:string;ln:string},kind:IssueKind,caseId:string|null,fields:readonly string[]=[],actorId?:string){
 const r=await db.query<{id:string}>('INSERT INTO his_intake_issue(inbound_file_id,ln,kind,case_id,details) VALUES($1,$2,$3,$4,$5) ON CONFLICT(inbound_file_id,kind) DO NOTHING RETURNING id',[file.id,file.ln,kind,caseId,json({fields})]);
 if(!r.rows[0])return;
 await db.query("INSERT INTO his_intake_issue_event(issue_id,event,case_id,actor_id,details) VALUES($1,'OPENED',$2,$3,$4)",[r.rows[0].id,caseId,actorId??null,json({fields})]);
 await appendAudit(db,{actorId,action:'INBOUND_ISSUE_OPENED',resourceType:'his_intake_issue',resourceId:r.rows[0].id,details:{reasonCode:kind,synthetic:true}});
}
async function autoClose(db:Queryable,fileId:string,kind:IssueKind,reasonCode:string){
 const r=await db.query<{id:string}>("UPDATE his_intake_issue SET state='AutoClosed',closed_at=now() WHERE inbound_file_id=$1 AND kind=$2 AND state IN ('Open','Proposed') RETURNING id",[fileId,kind]);
 for(const row of r.rows)await db.query("INSERT INTO his_intake_issue_event(issue_id,event,details) VALUES($1,'AUTO_CLOSED',$2)",[row.id,json({reasonCode})]);
}

/** S1 only (LD-02/LD-04): his_order + VERIFIED_BY_PET (trigger) + round 1 ReceivedInHIS at immutable P[23] component 2. Caller holds the LN lock. */
export async function applyS1(db:Queryable,file:{id:string},pet:Pet,target:Target,via:'AUTOMATIC'|'REGISTRATION'|'TWO_PERSON',actorId?:string){
 await db.query("UPDATE his_inbound_file SET state='Applied(S1)',case_id=$2,processed_at=now(),error_code=NULL WHERE id=$1",[file.id,target.case_id]);
 await db.query('INSERT INTO his_order(case_ln_id,inbound_file_id,his_received_at) VALUES($1,$2,$3)',[target.case_ln_id,file.id,pet.receivedAt]);
 const r=await db.query<{id:string}>("UPDATE specimen_round SET received_source='HIS_PET_RECEIPT',received_at=$2,state='ReceivedInHIS',collection_date=$3 WHERE case_ln_id=$1 AND round_number=1 AND received_at IS NULL AND state='Expected' RETURNING id",[target.case_ln_id,pet.receivedAt,pet.specimenAt.slice(0,10)]);
 if(r.rows.length!==1)throw Error('S1_NOT_EXPECTED');
 await reconcilePetPatient(db,target.case_id,r.rows[0].id,pet);
 await autoClose(db,file.id,'UNLINKED','LINKED');
 await caseEvent(db,target.case_id,'HIS_S1_RECEIVED',{via,inboundFileId:file.id});
 await collectionProvenance(db,target.case_id,r.rows[0].id,pet,actorId);
 await appendAudit(db,{actorId,action:'INBOUND_PET_APPLIED',resourceType:'his_inbound_file',resourceId:file.id,details:{outcome:'APPLIED_S1',reasonCode:via,synthetic:true}});
}

/** PET may fill blank ANC name/DOB fields; it never replaces a value or rewrites a locked Request snapshot. */
async function reconcilePetPatient(db:Queryable,caseId:string,roundId:string,pet:Pet){
 const result=(await db.query<{result:{filled:string[];conflicts:string[];pending:string[]}}>('SELECT p2_reconcile_pet_patient($1,$2,$3,$4) AS result',[caseId,roundId,pet.name.trim(),pet.dob.slice(0,10)])).rows[0]?.result;
 if(!result)return;
 if(result.filled.length)await db.query("INSERT INTO case_event(case_id,event_type,details) VALUES($1,'PET_IDENTITY_UPDATED',$2)",[caseId,{fields:result.filled,synthetic:true}]);
 if(result.conflicts.length)await db.query("INSERT INTO case_event(case_id,event_type,details) VALUES($1,'PET_IDENTITY_CONFLICT',$2)",[caseId,{fields:result.conflicts,synthetic:true}]);
 if(result.pending.length)await db.query("INSERT INTO case_event(case_id,event_type,details) VALUES($1,'PET_IDENTITY_PENDING_DOCUMENT',$2)",[caseId,{fields:result.pending,synthetic:true}]);
}

/**
 * OD-14 / CG-06: the HIS specimen collection date (P[23]) is stored on the round beside, never over, the P2 collection facts.
 * When a declared source disagrees, record a provenance conflict (source names only) for clinical review; nothing passes.
 */
async function collectionProvenance(db:Queryable,caseId:string,roundId:string,pet:Pet,actorId?:string){
 const his=pet.specimenAt.slice(0,10);
 const declared=(await db.query<{source:string;collection_date:string}>('SELECT DISTINCT ON(source) source,collection_date::text AS collection_date FROM p2_collection_fact WHERE case_id=$1 AND round_id=$2 ORDER BY source,sequence DESC',[caseId,roundId])).rows;
 const sources=declared.filter(d=>d.collection_date!==his).map(d=>d.source).sort();
 if(!sources.length)return;
 const roundNumber=(await db.query<{round_number:number}>('SELECT round_number FROM specimen_round WHERE id=$1',[roundId])).rows[0].round_number;
 await caseEvent(db,caseId,'COLLECTION_PROVENANCE_CONFLICT',{roundNumber,hisField:'specimenAt',sources});
 await appendAudit(db,{actorId,action:'COLLECTION_PROVENANCE_CONFLICT',resourceType:'nipt_case',resourceId:caseId,details:{reasonCode:'HIS_COLLECTION_DIFFERS',count:sources.length,synthetic:true}});
}

export async function lockedTarget(db:Queryable,ln:string){
 return (await db.query<Target>("SELECT l.id AS case_ln_id,l.case_id,c.registration_origin AS origin FROM case_ln l JOIN nipt_case c ON c.id=l.case_id WHERE l.ln=$1 AND l.verification<>'RETIRED' ORDER BY l.version DESC LIMIT 1 FOR UPDATE OF l",[ln])).rows[0];
}
export async function readPet(store:Pick<FileStore,'get'>,file:{sha256:string;filename:string;ln:string}){
 const pet=parsePet(await store.get(file.sha256),file.filename);if(pet.ln!==file.ln||pet.hash!==file.sha256)throw Error('UNVERIFIED_PET');return pet;
}

/**
 * Plan §10.2 ข้อ 7 matching for one stored intake. Caller owns the transaction; the LN advisory lock is shared with
 * registration and historical promotion (D-49). Only Ready intakes, or Unlinked intakes whose sole open issue is
 * UNLINKED, are evaluated automatically. No statement here addresses a specimen round other than round 1.
 */
export async function processInboundFile(db:Queryable,fileId:string,deps:InboundDeps,context?:RegistrationContext):Promise<ProcessOutcome>{
 const head=(await db.query<{ln:string|null}>('SELECT ln FROM his_inbound_file WHERE id=$1',[fileId])).rows[0];
 if(!head?.ln)return 'SKIPPED';
 await lockLn(db,head.ln);
 const file=(await db.query<FileRow>('SELECT id,sha256,state,ln,filename FROM his_inbound_file WHERE id=$1 FOR UPDATE',[fileId])).rows[0];
 if(!file||!['Ready','Unlinked'].includes(file.state))return 'SKIPPED';
 if(file.state==='Unlinked'){const open=(await db.query<{kind:string;state:string}>("SELECT kind,state FROM his_intake_issue WHERE inbound_file_id=$1 AND state IN ('Open','Proposed')",[fileId])).rows;if(open.length!==1||open[0].kind!=='UNLINKED'||open[0].state!=='Open')return 'SKIPPED';}
 const pet=await readPet(deps.store,file);
 const target=await lockedTarget(db,file.ln);
 if(!target){if(file.state!=='Ready')return 'SKIPPED';await setState(db,file.id,'Unlinked',null);await openIssue(db,file,'UNLINKED',null);return 'UNLINKED';}
 if(target.origin==='HISTORICAL'){
  // LD-10: no apply, no round, no origin change and no promotion from an intake.
  await setState(db,file.id,'HistoricalIntake',target.case_id);await openIssue(db,file,'HISTORICAL_LN_INTAKE',target.case_id);await autoClose(db,file.id,'UNLINKED','HISTORICAL_LN');return 'HISTORICAL_LN_INTAKE';
 }
 const order=(await db.query<{sha256:string;filename:string;ln:string}>('SELECT f.sha256,f.filename,$2::text AS ln FROM his_order_current o JOIN his_inbound_file_current f ON f.id=o.inbound_file_id JOIN specimen_round r ON r.id=o.round_id WHERE o.case_ln_id=$1 ORDER BY r.round_number DESC LIMIT 1',[target.case_ln_id,file.ln])).rows[0];
 if(order){
  // §6.6 (b): S1 already received. Never re-receive, never touch later rounds.
  await autoClose(db,file.id,'UNLINKED','S1_ALREADY_RECEIVED');
  const diff=petDifferences(await readPet(deps.store,order),pet);
  if(diff.identity.length){const kind=diff.identity.includes('hn')?'LN_REUSED_DIFFERENT_PATIENT':'LN_REUSED_OR_CHANGED';await setState(db,file.id,'Conflict',target.case_id);await openIssue(db,file,kind,target.case_id,diff.identity);await caseEvent(db,target.case_id,'HIS_LN_CONFLICT',{kind,fields:diff.identity,inboundFileId:file.id});return kind;}
  if(diff.order.length){
   const round=(await db.query<{id:string;round_number:number;previous_received_at:Date}>(`SELECT r.id,r.round_number,s.received_at previous_received_at
    FROM nipt_case c JOIN specimen_round r ON r.id=c.current_round_id JOIN redraw_request d ON d.id=r.redraw_request_id JOIN specimen_round_current s ON s.id=d.source_round_id
    WHERE c.id=$1 AND r.case_ln_id=$2 AND r.state='Expected' AND r.received_at IS NULL AND d.state='Requested' FOR UPDATE OF r`,[target.case_id,target.case_ln_id])).rows[0];
   // New receipt time, same immutable patient identity and an explicitly requested current round are all required.
   if(round?.round_number===2 && diff.order.includes('receivedAt') && new Date(pet.receivedAt)>round.previous_received_at){
    await db.query("UPDATE his_inbound_file SET state='Applied(Redraw)',case_id=$2,processed_at=now(),error_code=NULL WHERE id=$1",[file.id,target.case_id]);
    await db.query('INSERT INTO his_order(case_ln_id,inbound_file_id,his_received_at,round_id) VALUES($1,$2,$3,$4)',[target.case_ln_id,file.id,pet.receivedAt,round.id]);
    const received=await db.query("UPDATE specimen_round SET received_source='HIS_PET_RECEIPT',received_at=$2,state='ReceivedInHIS',collection_date=$3 WHERE id=$1 AND state='Expected' AND received_at IS NULL RETURNING id",[round.id,pet.receivedAt,pet.specimenAt.slice(0,10)]);
    if(received.rows.length!==1)throw Error('REDRAW_NOT_EXPECTED');
    await collectionProvenance(db,target.case_id,round.id,pet,context?.actorId);
    await caseEvent(db,target.case_id,'HIS_REDRAW_RECEIVED',{roundNumber:round.round_number,inboundFileId:file.id});
    await appendAudit(db,{actorId:context?.actorId,action:'INBOUND_PET_APPLIED',resourceType:'his_inbound_file',resourceId:file.id,details:{outcome:'APPLIED_REDRAW',count:round.round_number,synthetic:process.env.NIPT_MODE!=='operational'}});
    return 'APPLIED_REDRAW';
   }
   await setState(db,file.id,'S1IntegrityEvent',target.case_id);await openIssue(db,file,'S1_INTEGRITY_EVENT',target.case_id,diff.order);await caseEvent(db,target.case_id,'S1_INTEGRITY_EVENT',{fields:diff.order,inboundFileId:file.id});return 'S1_INTEGRITY_EVENT';}
  await setState(db,file.id,'DuplicateSameContent',target.case_id);return 'DUPLICATE';
 }
 const registrant=await (deps.identity??defaultIdentitySource).forCase(db,target.case_id);
 const cmp=compareRegistrant(registrant,pet,deps.lookupKey);
 if(cmp.outcome==='MATCH'){await applyS1(db,file,pet,target,context?.via??'AUTOMATIC',context?.actorId);return 'APPLIED_S1';}
 // Same terminal state whichever came first (AT-LDR-08): case keeps S1 Expected, intake stays Unlinked + issue.
 const kind=cmp.outcome==='MISMATCH'?'IDENTITY_MISMATCH':'IDENTITY_UNVERIFIED';
 await setState(db,file.id,'Unlinked',target.case_id);await openIssue(db,file,kind,target.case_id,cmp.outcome==='MISMATCH'?cmp.fields:[],context?.actorId);await autoClose(db,file.id,'UNLINKED',kind);
 return kind;
}

/** Ready intakes plus Unlinked intakes whose LN now has a case (rematch safety net). One transaction per intake. */
export async function processPending(db:Queryable,deps:InboundDeps,limit=500){
 const ids=(await db.query<{id:string}>(`SELECT f.id FROM his_inbound_file f WHERE f.state='Ready'
  OR (f.state='Unlinked' AND EXISTS(SELECT 1 FROM his_intake_issue i WHERE i.inbound_file_id=f.id AND i.kind='UNLINKED' AND i.state='Open')
      AND EXISTS(SELECT 1 FROM case_ln l WHERE l.ln=f.ln AND l.verification<>'RETIRED'))
  ORDER BY f.discovered_at,f.source_path,f.id LIMIT $1`,[limit])).rows.map(r=>r.id);
 const tx=transactional(db),outcomes:Record<string,number>={},failures:{id:string;code:string}[]=[];
 for(const id of ids){
  try{const outcome=await tx(client=>processInboundFile(client,id,deps));outcomes[outcome]=(outcomes[outcome]??0)+1;}
  catch(e){const code=errorCode(e);failures.push({id,code});await db.query('UPDATE his_inbound_file SET error_code=$2 WHERE id=$1',[id,code]);}
 }
 return {outcomes,failures};
}
