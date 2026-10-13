import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {appendAudit} from '../db/audit';
import {assertOutboundOrigin} from '../historical/barrier';
import {freezeSyntheticTransfer,initialTransfer,reserveSyntheticTransfer,advanceTransfer,type SyntheticDraft,type SyntheticTransfer,type TransferModel,type SyntheticGate,type TransferEvent} from './transfer';

const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const identifier=z.string().regex(/^SYNTHETIC-[A-Za-z0-9_-]+$/).max(100);
export interface TransferRow {id:string;fixture_id:string;sandbox_id:string;plan:SyntheticTransfer;model:TransferModel;gate:SyntheticGate;revision:number;}
type StoredDraft=Omit<SyntheticDraft,'pdf'> & {pdfHex:string};
export async function loadFixtureDraft(db:Queryable,fixtureId:string):Promise<SyntheticDraft>{
  const r=(await db.query<{draft:StoredDraft}>('SELECT draft FROM p6_fixture WHERE id=$1',[fixtureId])).rows[0];
  if(!r)throw Error('REGISTERED_FIXTURE_REQUIRED');const {pdfHex,...rest}=r.draft;return {...rest,pdf:Buffer.from(pdfHex,'hex')};
}
export async function transaction<T>(db:Queryable,run:()=>Promise<T>):Promise<T>{
  await db.query('BEGIN');try{const value=await run();await db.query('COMMIT');return value;}catch(e){await db.query('ROLLBACK');throw e;}
}

/** Enrollment is used ONLY by tools/p6 fixture tooling/tests under p6_fixture_writer. The web and
 * worker DB roles cannot call this successfully. Never maps a P5 report/release into a fixture. */
export async function registerFixture(db:Queryable,draft:SyntheticDraft,sandboxId:string){
  assertOutboundOrigin(draft.origin);   // P5H barrier: a historical case can never be queued
  identifier.parse(sandboxId);freezeSyntheticTransfer(draft,1);
  const {pdf,...rest}=draft,stored:StoredDraft={...rest,pdfHex:pdf.toString('hex')};
  const payload=JSON.stringify(stored),digest=hash(payload);
  return transaction(db,async()=>{
    await db.query('INSERT INTO p6_fixture(id,sandbox_id,draft,draft_hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[draft.fixtureId,sandboxId,stored,digest]);
    const prior=(await db.query<{draft_hash:string;sandbox_id:string}>('SELECT draft_hash,sandbox_id FROM p6_fixture WHERE id=$1',[draft.fixtureId])).rows[0];
    if(!prior||prior.draft_hash!==digest||prior.sandbox_id!==sandboxId)throw Error('FIXTURE_IMMUTABLE');
  });
}

export async function loadTransfer(db:Queryable,id:string):Promise<TransferRow>{
  z.uuid().parse(id);
  const row=(await db.query<TransferRow>('SELECT t.id,t.fixture_id,t.plan,t.model,t.gate,t.revision,f.sandbox_id FROM p6_transfer t JOIN p6_fixture f ON f.id=t.fixture_id WHERE t.id=$1',[id])).rows[0];
  if(!row)throw Error('P6_TRANSFER_NOT_FOUND');return row;
}
async function record(db:Queryable,row:TransferRow,code:string,event:Record<string,unknown>){
  await db.query('INSERT INTO p6_transfer_event(transfer_id,revision,code,event) VALUES($1,$2,$3,$4)',[row.id,row.revision,code,event]);
  await appendAudit(db,{action:'P6_'+code,resourceType:'p6_transfer',resourceId:row.id,details:{synthetic:true,outcome:row.model.state}});
}

export async function reserveFixture(db:Queryable,fixtureId:string,now=Date.now()):Promise<TransferRow>{
  identifier.parse(fixtureId);
  return transaction(db,async()=>{
    const stored=(await db.query<{draft:StoredDraft;sandbox_id:string}>('SELECT draft,sandbox_id FROM p6_fixture WHERE id=$1',[fixtureId])).rows[0];
    if(!stored)throw Error('REGISTERED_FIXTURE_REQUIRED');
    assertOutboundOrigin(stored.draft.origin);
    const {pdfHex,...rest}=stored.draft,draft:SyntheticDraft={...rest,pdf:Buffer.from(pdfHex,'hex')};
    const scope=JSON.stringify([stored.sandbox_id,draft.input.order.ln,draft.lnGeneration]);
    // Reservation lock is deliberately broader than report version; revisions/redraws share N.
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[scope]);
    const rows=(await db.query<{plan:SyntheticTransfer}>('SELECT t.plan FROM p6_transfer t JOIN p6_fixture f ON f.id=t.fixture_id WHERE f.sandbox_id=$1',[stored.sandbox_id])).rows;
    const history=rows.map(r=>r.plan),prior=history.find(p=>p.ln===draft.input.order.ln&&p.lnGeneration===draft.lnGeneration&&p.reportVersionId===draft.reportVersionId);
    const n=prior?.sequence??Math.max(0,...history.filter(p=>p.ln===draft.input.order.ln&&p.lnGeneration===draft.lnGeneration).map(p=>p.sequence))+1;
    const plan=freezeSyntheticTransfer(draft,n),decision=reserveSyntheticTransfer(plan,history);
    if(decision.decision==='REUSE'){
      const r=(await db.query<{id:string}>('SELECT id FROM p6_transfer WHERE ln=$1 AND ln_generation=$2 AND report_version_id=$3 AND sandbox_id=$4',[plan.ln,plan.lnGeneration,plan.reportVersionId,stored.sandbox_id])).rows[0];
      return loadTransfer(db,r.id);
    }
    const model=initialTransfer(plan,now),gate:SyntheticGate={epoch:plan.epoch,fixtureEligible:true,consentValid:true,settingsVersion:plan.settingsVersion};
    const r=(await db.query<{id:string}>('INSERT INTO p6_transfer(fixture_id,ln,ln_generation,report_version_id,sequence,res_destination,pdf_destination,res_name,pdf_name,plan,model,gate,sandbox_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id',
      [fixtureId,plan.ln,plan.lnGeneration,plan.reportVersionId,n,hash(stored.sandbox_id+':'+plan.resDestinationId),hash(stored.sandbox_id+':'+plan.pdfDestinationId),plan.resName,plan.pdfName,plan,model,gate,stored.sandbox_id])).rows[0];
    const row=await loadTransfer(db,r.id);await record(db,row,'RESERVED',{});return row;
  });
}

async function transition(db:Queryable,id:string,event:TransferEvent,expectedRevision:number|undefined,now:number):Promise<TransferRow>{
  return transaction(db,async()=>{
    await db.query('SELECT id FROM p6_transfer WHERE id=$1 FOR UPDATE',[id]);
    const row=await loadTransfer(db,id);if(expectedRevision!==undefined&&row.revision!==expectedRevision)throw Error('STALE_TRANSFER');
    if(expectedRevision===undefined&&['CANCELLED','RECONCILIATION_REQUIRED','FAILED_NEEDS_ADMIN','SYNTHETIC_CONFIRMED','UNKNOWN_TIMEOUT'].includes(row.model.state))return row;
    const changed=row.gate.epoch!==row.plan.epoch||!row.gate.fixtureEligible||!row.gate.consentValid||row.gate.settingsVersion!==row.plan.settingsVersion;
    // A successful sentinel write observed after cancellation is always reconciliation, even if
    // cancellation committed between the worker's prior read and this locked fresh checkpoint.
    const effective=expectedRevision===undefined&&event.type==='OK_OBSERVED'&&changed?{type:'UNEXPECTED_OK'} as const:event;
    const model=advanceTransfer(row.model,effective,row.gate,expectedRevision===undefined?Math.max(now,row.model.updatedAt):now);
    if(model===row.model)return row;
    await db.query('UPDATE p6_transfer SET model=$2,revision=revision+1,updated_at=now() WHERE id=$1',[id,model]);
    const next=await loadTransfer(db,id);await record(db,next,model.log.at(-1)!.code,effective);return next;
  });
}
export async function applyEvent(db:Queryable,id:string,event:TransferEvent,expectedRevision:number,now=Date.now()):Promise<TransferRow>{return transition(db,id,event,expectedRevision,now);}
/** Workers hold the per-transfer session lock; gate controls intentionally remain concurrent.
 * Resolve controls and checkpoint together under a fresh row lock instead of an optimistic read gap. */
export async function applyWorkerEvent(db:Queryable,id:string,event:TransferEvent):Promise<TransferRow>{return transition(db,id,event,undefined,Date.now());}

export async function cancelFixtureTransfer(db:Queryable,id:string,reason:'VOID'|'WITHDRAWAL'|'SUPERSEDED'|'CONFIG_CHANGED'){
  if(!['VOID','WITHDRAWAL','SUPERSEDED','CONFIG_CHANGED'].includes(reason))throw Error('INVALID_CANCEL_REASON');
  return transaction(db,async()=>{
    await db.query('SELECT id FROM p6_transfer WHERE id=$1 FOR UPDATE',[id]);const row=await loadTransfer(db,id);
    const gate={...row.gate,epoch:row.gate.epoch+1,fixtureEligible:false,...(reason==='WITHDRAWAL'?{consentValid:false}:{})};
    const postDelivery=row.model.state==='OK_OBSERVED'||row.model.awaitingAt!==undefined;
    const model=postDelivery?advanceTransfer(row.model,{type:'UNEXPECTED_OK'},gate,Math.max(Date.now(),row.model.updatedAt)):row.model;
    await db.query('UPDATE p6_transfer SET gate=$2,model=$3,revision=revision+1,updated_at=now() WHERE id=$1',[id,gate,model]);
    const next=await loadTransfer(db,id);await record(db,next,'GATE_CHANGED',{reason});return next;
  });
}
export async function readHistory(db:Queryable,id:string){
  const row=await loadTransfer(db,id);
  const events=(await db.query<{revision:number;code:string;event:Record<string,unknown>}>('SELECT revision,code,event FROM p6_transfer_event WHERE transfer_id=$1 ORDER BY revision',[id])).rows;
  const reconciliations=(await db.query('SELECT evidence_id,actor_id,resolution,pdf_hash,res_hash,observed_at FROM p6_reconciliation WHERE transfer_id=$1 ORDER BY created_at',[id])).rows;
  return {id:row.id,fixtureId:row.fixture_id,state:row.model.state,sequence:row.plan.sequence,pdfHash:row.plan.pdfHash,resHash:row.plan.resHash,hisConfirmed:false,reconciliationRequired:row.model.reconciliationRequired,events,reconciliations};
}

const reconciliationSchema=z.strictObject({evidenceId:identifier,actorId:identifier,resolution:z.enum(['OBSERVED_SANDBOX_DELIVERY','NO_DELIVERY','KEEP_HOLD']),pdfHash:z.string(),resHash:z.string(),observedAt:z.number().int().nonnegative()});
export async function recordReconciliation(db:Queryable,id:string,input:z.infer<typeof reconciliationSchema>){
  const d=reconciliationSchema.parse(input);
  return transaction(db,async()=>{
    await db.query('SELECT id FROM p6_transfer WHERE id=$1 FOR UPDATE',[id]);const row=await loadTransfer(db,id);
    if(!row.model.reconciliationRequired)throw Error('RECONCILIATION_NOT_REQUIRED');
    if(d.pdfHash!==row.plan.pdfHash||d.resHash!==row.plan.resHash||d.observedAt<row.model.startedAt||d.observedAt>Date.now())throw Error('EVIDENCE_MISMATCH');
    const prior=(await db.query<{actor_id:string;resolution:string;pdf_hash:string;res_hash:string;observed_at:string}>('SELECT * FROM p6_reconciliation WHERE transfer_id=$1 AND evidence_id=$2',[id,d.evidenceId])).rows[0];
    if(prior){if(prior.actor_id!==d.actorId||prior.resolution!==d.resolution||prior.pdf_hash!==d.pdfHash||prior.res_hash!==d.resHash||Number(prior.observed_at)!==d.observedAt)throw Error('EVIDENCE_IMMUTABLE');return;}
    await db.query('INSERT INTO p6_reconciliation(transfer_id,evidence_id,actor_id,resolution,pdf_hash,res_hash,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,d.evidenceId,d.actorId,d.resolution,d.pdfHash,d.resHash,d.observedAt]);
    await appendAudit(db,{action:'P6_RECONCILIATION_RECORDED',resourceType:'p6_transfer',resourceId:id,details:{synthetic:true,outcome:d.resolution}});
    // Recording an investigation never unlocks replay, deletes files, or asserts HIS confirmation.
  });
}
export async function readMonitoring(db:Queryable){
  return {syntheticOnly:true,clinicalPublisherEnabled:false,
    counts:(await db.query("SELECT model->>'state' state,count(*)::int count FROM p6_transfer GROUP BY model->>'state' ORDER BY state")).rows,
    workers:(await db.query('SELECT worker_id,observed_at,details FROM p6_worker_heartbeat ORDER BY worker_id')).rows};
}
