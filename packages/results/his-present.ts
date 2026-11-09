import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {assertSession,need,audit,uuid,LabError,type Staff} from '../lab/core';
import {attestHisPresence,autoLinkUnique,backlogRelinkPreview,validationGateIssues} from './service';
import {isSendResolvable} from './release-queue';

// Owner 2026-11-09: an external (ReadyGen) PDF that HIS already holds is linked to its patient and shown there, and is never sent again. This is the one place that does it for
// any such PDF, now and in the future: the board's button, the pick-a-patient step and the one-time backlog script all call linkAndShowInHis.
export type ShowOutcome='SHOWN'|'LINKED_AND_SHOWN'|'LINKED_NOT_SHOWN'|'NOT_CHANGED';
export type ShowResult={versionId:string;from:string;to:string;outcome:ShowOutcome;reason:string|null};
export const isShown=(o:ShowOutcome)=>o==='SHOWN'||o==='LINKED_AND_SHOWN';

/** One external PDF, inside the caller's transaction.
 *  - An unlinked one is linked only by the same clean rule as the import (HN + lab number, exactly one current latest attempt, nobody decided it before); otherwise it is
 *    reported with the reason and a person picks the patient.
 *  - Then "มีผลใน HIS แล้ว" is recorded; its identity guard (HN, date of birth, lab number must not contradict the patient) still applies.
 *  - `skipWaiting`: a Linked / ValidationBlocked result whose only open items are what "ส่ง HIS" records itself is waiting to be sent, not stuck; the backlog script (which chooses
 *    its own scope) leaves it alone, while a person who selected it on purpose is not second-guessed.
 *  `claimed` holds the rounds an earlier PDF of the same run links, so two PDFs of one round are not both linked. Nothing here reviews, certifies, voids or sends. */
export async function linkAndShowInHis(db:Queryable,actor:Staff,versionId:string,o:{claimed?:Set<string>;skipWaiting?:boolean;note?:string}={}):Promise<ShowResult>{
 const v=(await db.query<{state:string;origin:string;kind:string;round_id:string|null;current_round_id:string|null}>('SELECT v.state,v.origin,v.kind,v.round_id,c.current_round_id FROM result_report_version v LEFT JOIN nipt_case c ON c.id=v.case_id WHERE v.id=$1',[versionId])).rows[0];
 if(!v)throw new LabError('NOT_FOUND',404);
 const out=(to:string,outcome:ShowOutcome,reason:string|null=null):ShowResult=>({versionId,from:v.state,to,outcome,reason});
 if(v.kind!=='RESULT'||v.origin!=='EXTERNAL_READYGEN')return out(v.state,'NOT_CHANGED','NOT_AN_EXTERNAL_PDF');
 if(v.state==='LinkConflict')return out(v.state,'NOT_CHANGED','LINK_CONFLICT_NEEDS_HUMAN');
 if(v.round_id&&v.round_id!==v.current_round_id)return out(v.state,'NOT_CHANGED','ROUND_NOT_CURRENT');
 let linked=false;
 if(v.state==='Unlinked'){
  const p=await backlogRelinkPreview(db,actor,versionId);
  if(p.humanDecided)return out(v.state,'NOT_CHANGED','HUMAN_DECISION_EXISTS');
  if(!p.match)return out(v.state,'NOT_CHANGED',p.reason??'NOT_A_CLEAN_MATCH');
  if(p.reason||!p.roundId||o.claimed?.has(p.roundId))return out(v.state,'NOT_CHANGED',p.reason??'SERIES_NOT_EMPTY');
  o.claimed?.add(p.roundId);
  const x=await autoLinkUnique(db,actor,versionId);
  if(!x.linked)return out(v.state,'NOT_CHANGED',x.reason);
  linked=true;
 }else if(o.skipWaiting&&(v.state==='Linked'||v.state==='ValidationBlocked')){
  const g=await validationGateIssues(db,versionId).catch(()=>({failed:[] as string[],pending:[] as string[]}));
  if(isSendResolvable(g))return out(v.state,'NOT_CHANGED','WAITING_TO_BE_SENT_NOT_STUCK');
 }
 const state=async()=>(await db.query<{state:string}>('SELECT state FROM result_report_version WHERE id=$1',[versionId])).rows[0].state;
 await db.query('SAVEPOINT show_in_his');
 try{
  await attestHisPresence(db,actor,{versionId,confirmed:true,...(o.note?{note:o.note}:{})});
  await db.query('RELEASE SAVEPOINT show_in_his');
  return out(await state(),linked?'LINKED_AND_SHOWN':'SHOWN');
 }catch(e){
  await db.query('ROLLBACK TO SAVEPOINT show_in_his');await db.query('RELEASE SAVEPOINT show_in_his');
  if(!(e instanceof LabError))throw e;
  return out(await state(),linked?'LINKED_NOT_SHOWN':'NOT_CHANGED',e.code);
 }
}

/** Many PDFs with one confirmation (the board). Each runs in its own savepoint, so one that cannot be done never stops the others; the reason comes back per item. */
export async function showInHisBatch(db:Queryable,user:Staff,input:unknown):Promise<{items:ShowResult[]}>{
 await assertSession(db,user);need(user,'his.reconcile');
 const d=z.strictObject({confirmed:z.literal(true),items:z.array(z.strictObject({versionId:uuid})).min(1).max(100),note:z.string().trim().max(500).refine(x=>!/\d{13}/.test(x),'REASON_TEXT_INVALID').optional()}).parse(input);
 const items:ShowResult[]=[],claimed=new Set<string>();
 for(const it of d.items){
  await db.query('SAVEPOINT show_item');
  try{items.push(await linkAndShowInHis(db,user,it.versionId,{claimed,...(d.note?{note:d.note}:{})}));await db.query('RELEASE SAVEPOINT show_item');}
  catch(e){await db.query('ROLLBACK TO SAVEPOINT show_item');await db.query('RELEASE SAVEPOINT show_item');if(!(e instanceof LabError))throw e;
   const s=(await db.query<{state:string}>('SELECT state FROM result_report_version WHERE id=$1',[it.versionId])).rows[0]?.state??'';
   items.push({versionId:it.versionId,from:s,to:s,outcome:'NOT_CHANGED',reason:e.code});}
 }
 await audit(db,user,'RESULT_HIS_PRESENCE_ATTESTED_BATCH','RESULT_VERSION',undefined,{count:items.filter(i=>isShown(i.outcome)).length,outcome:'BATCH'});
 return {items};
}
