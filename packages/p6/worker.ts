import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import type {Queryable} from '../db/connection';
import {applyWorkerEvent,loadTransfer,loadFixtureDraft,type TransferRow} from './journal';
import {freezeSyntheticTransfer,type TransferEvent} from './transfer';
import {openSandbox,assertSandboxEnabled,type Artifact,type FileHook} from './sandbox';

const terminal=new Set(['CANCELLED','RECONCILIATION_REQUIRED','FAILED_NEEDS_ADMIN','SYNTHETIC_CONFIRMED','UNKNOWN_TIMEOUT']);
const stages:Record<string,Artifact>={PREPARED:'PDF',PDF_VERIFIED:'RES',RES_VERIFIED:'BACKUP',BACKUP_VERIFIED:'OK'};
const okHash=createHash('sha256').update(Buffer.from([255,254])).digest('hex');
const gated=(r:TransferRow)=>r.gate.epoch!==r.plan.epoch||!r.gate.fixtureEligible||!r.gate.consentValid||r.gate.settingsVersion!==r.plan.settingsVersion;
function proof(row:TransferRow):TransferEvent {
  switch(row.model.state){
    case 'PREPARED':return {type:'PDF_VERIFIED',sha256:row.plan.pdfHash};
    case 'PDF_VERIFIED':return {type:'RES_VERIFIED',sha256:row.plan.resHash};
    case 'RES_VERIFIED':return {type:'BACKUP_VERIFIED',pdfHash:row.plan.pdfHash,resHash:row.plan.resHash};
    case 'BACKUP_VERIFIED':return {type:'OK_OBSERVED',sha256:okHash};
    case 'OK_OBSERVED':return {type:'POST_OK_CHECK'};
    case 'RETRY_PENDING':return {type:'RETRY'};
    default:return {type:'PICKUP'};
  }
}
export interface WorkerTestHooks {fileHook?:FileHook;afterArtifact?:(artifact:Artifact)=>Promise<void>;afterFinalGateRead?:()=>Promise<void>;}

/** One pinned connection holds a session lock across independently committed checkpoints/I/O.
 * Process loss releases the lock; restart re-verifies complete pre-OK files. No lease can expire
 * underneath an active writer. No production release/case/job payload enters this worker. */
export async function runTransfer(db:Queryable,id:string,hooks:WorkerTestHooks={}) {
  assertSandboxEnabled();
  const key='P6_SANDBOX_TRANSFER:'+id;
  const lock=(await db.query<{acquired:boolean}>('SELECT pg_try_advisory_lock(hashtextextended($1,0)) acquired',[key])).rows[0];
  if(!lock?.acquired)return 'BUSY';
  try{
    let row=await loadTransfer(db,id);if(terminal.has(row.model.state))return row.model.state;
    const dispatch=async(event:TransferEvent)=>{
      row=await applyWorkerEvent(db,id,event);return row;
    };
    if(gated(row)){await dispatch(proof(row));return row.model.state;}
    const draft=await loadFixtureDraft(db,row.fixture_id);
    if(freezeSyntheticTransfer(draft,row.plan.sequence).fingerprint!==row.plan.fingerprint)throw Error('FROZEN_CONTRACT_CHANGED');
    let sandbox;
    try{sandbox=await openSandbox(row.sandbox_id,draft.settings,async event=>{
      await hooks.fileHook?.(event);
      if(['BEFORE_WRITE','AFTER_TEMP_SYNC','BEFORE_PUBLISH'].includes(event.point)){
        const current=await loadTransfer(db,id);if(gated(current))throw Error('P6_GATE_CHANGED');
      }
    },async publish=>{
      await db.query('BEGIN');
      try{
        await db.query('SELECT id FROM p6_transfer WHERE id=$1 FOR UPDATE',[id]);
        if(gated(await loadTransfer(db,id)))throw Error('P6_GATE_CHANGED');
        await hooks.afterFinalGateRead?.();
        await publish();await db.query('COMMIT');
      }catch(e){await db.query('ROLLBACK');throw e;}
    });}
    catch{
      if(stages[row.model.state])await dispatch({type:'FAILURE',stage:stages[row.model.state],code:'COLLISION'});
      else await dispatch({type:'UNEXPECTED_OK'});
      return row.model.state;
    }
    try{
      if(['PREPARED','PDF_VERIFIED','RES_VERIFIED','BACKUP_VERIFIED','RETRY_PENDING'].includes(row.model.state)&&await sandbox.exists('OK',row.plan)){
        await dispatch({type:'UNEXPECTED_OK'});return row.model.state;
      }
    }catch{await dispatch({type:'UNEXPECTED_OK'});return row.model.state;}
    if(row.model.state==='RETRY_PENDING'){
      if(Date.now()<(row.model.nextRetryAt??Infinity))return 'BACKOFF_PENDING';
      await dispatch({type:'RETRY'});
    }
    while(stages[row.model.state]){
      row=await loadTransfer(db,id);if(gated(row)){await dispatch({type:'WRITE_STARTED',stage:stages[row.model.state]});return row.model.state;}
      const stage=stages[row.model.state];
      await dispatch({type:'WRITE_STARTED',stage});if(terminal.has(row.model.state))return row.model.state;
      try{await sandbox.ensure(stage,row.plan);}
      catch(e){
        if(stage==='OK'&&e instanceof Error&&e.message==='P6_GATE_CHANGED')await dispatch({type:'WRITE_STARTED',stage:'OK'});
        else if(stage==='OK')await dispatch({type:'UNEXPECTED_OK'});
        else await dispatch({type:'FAILURE',stage,code:e instanceof Error&&['DESTINATION_COLLISION','LINK_PROHIBITED','UNSAFE_SANDBOX_PATH'].includes(e.message)?'COLLISION':'IO_ERROR'});
        return row.model.state;
      }
      // Test-only process-stop injection intentionally bypasses normal error/retry handling,
      // reproducing a complete file left before its DB proof checkpoint.
      await hooks.afterArtifact?.(stage);
      row=await loadTransfer(db,id);
      if(stage==='OK'&&gated(row)){await dispatch({type:'UNEXPECTED_OK'});return row.model.state;}
      await dispatch(proof(row));
    }
    if(row.model.state==='OK_OBSERVED'){
      // Never recreate a missing sentinel after the write checkpoint.
      if(!await sandbox.exists('OK',row.plan)){await dispatch({type:'UNEXPECTED_OK'});return row.model.state;}
      await dispatch({type:'POST_OK_CHECK'});
    }
    if(['AWAITING_CONFIRMATION','PICKED_UP_UNCONFIRMED'].includes(row.model.state)){
      row=await loadTransfer(db,id);if(gated(row)){await dispatch({type:'PICKUP'});return row.model.state;}
      if(Date.now()>=(row.model.awaitingAt??Infinity)+row.plan.confirmationTimeoutMs)await dispatch({type:'TIMEOUT'});
      else if(row.model.state==='AWAITING_CONFIRMATION'&&(!await sandbox.exists('OK',row.plan)||!await sandbox.exists('RES',row.plan)))await dispatch({type:'PICKUP'});
    }
    return row.model.state;
  }finally{await db.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);}
}

/** Opt-in extension of the existing application's worker. No old outbox kind/settings changes. */
export async function runP6Cycle(pool:Pool){
  if(process.env.NIPT_P6_SANDBOX_ENABLED!=='yes')return {processed:0,busy:0};
  assertSandboxEnabled();const db=await pool.connect();let processed=0,busy=0,lastError:string|null=null;
  try{
    const rows=(await db.query<{id:string}>("SELECT id FROM p6_transfer WHERE model->>'state' IN ('PREPARED','PDF_VERIFIED','RES_VERIFIED','BACKUP_VERIFIED','OK_OBSERVED','AWAITING_CONFIRMATION','PICKED_UP_UNCONFIRMED','RETRY_PENDING') ORDER BY CASE WHEN model->>'state' IN ('AWAITING_CONFIRMATION','PICKED_UP_UNCONFIRMED') THEN 1 ELSE 0 END,created_at")).rows;
    for(const r of rows){try{const outcome=await runTransfer(db,r.id);if(outcome==='BUSY')busy++;else processed++;}catch{lastError='P6_CYCLE_FAILED';}}
    await db.query("INSERT INTO p6_worker_heartbeat(worker_id,details) VALUES('SYNTHETIC-P6-WORKER',$1) ON CONFLICT(worker_id) DO UPDATE SET observed_at=now(),details=excluded.details",[{processed,busy,lastError,syntheticOnly:true}]);
    return {processed,busy};
  }finally{db.release();}
}
