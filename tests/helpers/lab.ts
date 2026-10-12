import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {Queryable} from '../../packages/db/connection';
import {registerCase} from '../../packages/db/registration';
import {FileStore} from '../../packages/storage';
import {SETTINGS} from '../../packages/settings/catalog';
import {proposeSetting,validateSetting,approveSetting,activateSetting} from '../../packages/settings/service';
import type {P4Document} from '../../packages/pdf/p4';
import type {Principal} from '../../packages/security/policy';

/** Runs fn inside BEGIN/COMMIT on a single connection (PGlite or pg.Client), like withTransaction in the app. */
export async function tx<T>(db:Queryable,fn:(db:Queryable)=>Promise<T>):Promise<T>{await db.query('BEGIN');try{const r=await fn(db);await db.query('COMMIT');return r;}catch(e){await db.query('ROLLBACK');throw e;}}
export async function labUsers(db:Queryable,suffix=randomUUID().slice(0,8)){
 const add=async(role:string,name:string,approvedBy?:string)=>{const id=(await db.query<{id:string}>("INSERT INTO app_user(username,display_name,password_hash) VALUES($1,$2,'$argon2id$v=19$synthetic') RETURNING id",[`synthetic.${name}.${suffix}`,`ผู้ใช้จำลอง ${name}`])).rows[0].id;await db.query('INSERT INTO role_assignment(user_id,role,approved_by) VALUES($1,$2,$3)',[id,role,approvedBy??null]);return {id,roles:[role],unitIds:[],permissions:[]} as unknown as Principal;};
 const approver=await add('CLINICAL_APPROVER','approver'),staff=await add('LAB_STAFF','lab'),staff2=await add('LAB_STAFF','lab2'),certifier=await add('LAB_CERTIFIER','certifier',approver.id),auditor=await add('AUDITOR','auditor');
 const unit=(await db.query<{id:string}>('INSERT INTO unit(code,name) VALUES($1,$2) RETURNING id',[`SYNTHETIC_P4_${suffix}`,'หน่วยจำลอง P4'])).rows[0].id;
 const anc={...(await add('ANC_NURSE','anc')),unitIds:[unit]} as Principal;
 return {approver,staff,staff2,certifier,auditor,anc,unit};
}
/** Maker-checker activation of the Laboratory setting (CLINICAL risk): certifier proposes, clinical approver approves. */
export async function setPendingPolicy(db:Queryable,u:{certifier:Principal;approver:Principal},policy:'HOLD'|'PROCEED_SYNTHETIC_LABELLED'){
 return tx(db,async t=>{const id=await proposeSetting(t,u.certifier,'laboratory',{...SETTINGS.laboratory.default,pendingGovernanceGate:policy},'SYNTHETIC_P4_POLICY');await validateSetting(t,u.certifier,id,async()=>true);await approveSetting(t,u.approver,id);await activateSetting(t,u.approver,id);return id;});
}
let seq=0;
/** A synthetic LAB_DIRECT case with verified paper Request/Consent evidence for round 1. No HIS receipt yet. */
export async function syntheticCase(db:Queryable,u:{staff:Principal;unit:string},o:{ln?:string;pregnancy?:'Singleton'|'Twins';clinical?:string;evidence?:boolean}={}){
 const ln=o.ln??`0099${String(Date.now()).slice(-6)}${String(++seq).padStart(3,'0')}`;
 const r=await registerCase(db,{ln,identityKey:createHash('sha256').update('SYNTHETIC-P4-'+ln).digest('hex'),origin:'LAB_DIRECT',actorId:u.staff.id,idempotencyKey:'synthetic_p4_'+randomUUID().replaceAll('-','')});
 const caseId=r.caseId!;await db.query('INSERT INTO case_unit_scope(case_id,unit_id) VALUES($1,$2)',[caseId,u.unit]);
 const round=(await db.query<{id:string}>('SELECT current_round_id id FROM nipt_case WHERE id=$1',[caseId])).rows[0].id;
 if(o.evidence!==false){
  const panel={requestComplete:'Complete',decision:null,signatures:null,representative:null,history1to5:'AllNo',ga:'Over10to18',bmi:'AtMost40',conditionA:'NotApplicable',conditionB:'NotApplicable',vanishingTwin:'None',pregnancyType:o.pregnancy??'Singleton',fetalSex:'DoNotWant',collectionDate:null};
  await db.query("INSERT INTO p2_paper_review(case_id,round_id,kind,template_version,document_reference,panel,status,location,reason,verifier_id) VALUES($1,$2,'REQUEST','SYNTHETIC-FM01-v1','SYNTHETIC-DOC',$3,'Verified','SYNTHETIC-LOCATION','SYNTHETIC_REVIEW',$4)",[caseId,round,JSON.stringify(panel),u.staff.id]);
  await db.query("INSERT INTO p2_paper_review(case_id,round_id,kind,template_version,document_reference,panel,status,location,reason,verifier_id) VALUES($1,$2,'CONSENT','SYNTHETIC-FM02-v1','SYNTHETIC-DOC',$3,'Verified','SYNTHETIC-LOCATION','SYNTHETIC_REVIEW',$4)",[caseId,round,JSON.stringify({decision:'Granted',signatures:'Complete',representative:'NotRequired'}),u.staff.id]);
  await db.query("INSERT INTO clinical_snapshot(case_id,round_id,rule_version,input_snapshot,result) VALUES($1,$2,'SYNTHETIC-NEGATIVE-ONLY-v1','{}',$3)",[caseId,round,JSON.stringify({state:o.clinical??'PendingClinicalReview',passed:false})]);
 }
 const lnId=(await db.query<{id:string}>('SELECT id FROM case_ln WHERE case_id=$1',[caseId])).rows[0].id;
 return {caseId,roundId:round,ln,lnId};
}
/** Plays the HIS S1 receipt exactly as P3 applyS1 does: applied PET + his_order + round 1 ReceivedInHIS at the immutable HIS time. */
export async function receiveS1(db:Queryable,c:{roundId:string;lnId:string},at=new Date(),collectionDate='2026-10-10'){
 const file=(await db.query<{id:string}>("INSERT INTO his_inbound_file(sha256,state) VALUES($1,'Applied(S1)') RETURNING id",[createHash('sha256').update(randomUUID()).digest('hex')])).rows[0].id;
 await db.query('INSERT INTO his_order(case_ln_id,inbound_file_id,his_received_at) VALUES($1,$2,$3)',[c.lnId,file,at]);
 await db.query("UPDATE specimen_round SET received_source='HIS_PET_RECEIPT',received_at=$2,state='ReceivedInHIS',collection_date=$3 WHERE id=$1",[c.roundId,at,collectionDate]);
}
export async function docDeps(){
 const base=await mkdtemp(path.join(os.tmpdir(),'nipt-p4-')),store=new FileStore(path.join(base,'files'));const rendered:P4Document[]=[];
 // Deterministic fake renderer for DB tests; the real Chromium renderer is exercised in renderer/browser tests.
 const render=async(doc:P4Document)=>{rendered.push(doc);return Buffer.from('%PDF-1.4\n% SYNTHETIC TEST\n'+JSON.stringify(doc));};
 return {deps:{render,store},rendered,close:()=>rm(base,{recursive:true,force:true})};
}
export const attemptOf=async(db:Queryable,roundId:string,n=1)=>(await db.query<{id:string;state:string;printed_sample_id:string|null}>('SELECT id,state,printed_sample_id FROM analytical_attempt WHERE round_id=$1 AND attempt_number=$2',[roundId,n])).rows[0];
export const version=async(db:Queryable,batchId:string)=>(await db.query<{version:number}>('SELECT version FROM lab_batch WHERE id=$1',[batchId])).rows[0].version;
