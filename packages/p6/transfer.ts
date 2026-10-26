/** P6 pure contract model only. Events represent synthetic observations, never commands to a host.
 * No filesystem/network/SQL imports, no queue registration, and no production publisher. */
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {timestamp} from '../integrations/res';
import {pdfFilename, serializeSyntheticRes,serializeOperationalRes, type ResProfile, type OperationalResInput} from './res';

const digest=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const canonical=(value:unknown):string=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b,'en'))):v);
const id=z.string().regex(/^[A-Za-z0-9_-]+$/).max(100);
const integer=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const sha=z.string().regex(/^[a-f0-9]{64}$/);
const directory=z.string().max(200).regex(/^simulator\/p6\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/);
const settingsSchema=z.strictObject({
  version:id,resDirectory:directory,pdfDirectory:directory,backupDirectory:directory,
  retryDelaysMs:z.array(z.number().int().positive().max(86400000)).max(10),
  confirmationTimeoutMs:z.number().int().positive().max(86400000),
  connection:z.strictObject({revisionId:z.uuid(),resPath:z.string().min(1).max(500),pdfPath:z.string().min(1).max(500),backupPath:z.string().min(1).max(500),secretRef:z.uuid().nullable()}).optional(),
}).superRefine((s,ctx)=>{
  if(s.connection&&!['SYNTHETIC-SETTINGS-'+s.connection.revisionId,'OPERATIONAL-SETTINGS-'+s.connection.revisionId].includes(s.version))ctx.addIssue({code:'custom',message:'CONFIGURATION_VERSION_MISMATCH'});
  const paths=[s.resDirectory,s.pdfDirectory,s.backupDirectory];
  if(paths.some((a,i)=>paths.some((b,j)=>i!==j&&(a===b||a.startsWith(b+'/')))))ctx.addIssue({code:'custom',message:'OVERLAPPING_PATHS'});
});
export function validateSyntheticPaths(settings:unknown){return settingsSchema.parse(settings);}
export interface SyntheticDraft {
  mode?:'OPERATIONAL_RELEASE';
  fixtureId:string;reportVersionId:string;roundId:string;attemptId:string;
  origin:'ANC'|'LAB_DIRECT';lnGeneration:number;roundNumber:number;epoch:number;
  input:OperationalResInput;profile:ResProfile;pdf:Buffer;
  settings:z.infer<typeof settingsSchema>;
  round2Policy?:'CURRENT_ROUND'|'ORIGINAL_ORDER';roundSpecimenAt?:string;originalSpecimenAt?:string;
}
const draftSchema=z.strictObject({
  mode:z.literal('OPERATIONAL_RELEASE').optional(),
  fixtureId:id,reportVersionId:id,roundId:id,attemptId:id,origin:z.enum(['ANC','LAB_DIRECT']),
  lnGeneration:integer.refine(n=>n>0),roundNumber:integer.refine(n=>n>0),epoch:integer,
  input:z.unknown(),profile:z.unknown(),pdf:z.instanceof(Buffer),settings:settingsSchema,
  round2Policy:z.enum(['CURRENT_ROUND','ORIGINAL_ORDER']).optional(),roundSpecimenAt:z.string().optional(),originalSpecimenAt:z.string().optional(),
});

/** Hex strings deliberately avoid mutable Buffers in a frozen payload. No released DB row is fabricated. */
export interface SyntheticTransfer {
  readonly mode:'CONTRACT_ONLY'|'OPERATIONAL_RELEASE'; readonly fixtureId:string;readonly reportVersionId:string;
  readonly roundId:string;readonly attemptId:string;readonly origin:'ANC'|'LAB_DIRECT';
  readonly ln:string;readonly lnGeneration:number;readonly roundNumber:number;readonly sequence:number;readonly epoch:number;
  readonly resName:string;readonly pdfName:string;readonly okName:string;
  readonly resHash:string;readonly pdfHash:string;readonly resHex:string;readonly pdfHex:string;
  readonly profileVersion:string;readonly profileHash:string;readonly settingsVersion:string;readonly settingsHash:string;
  readonly resDestinationId:string;readonly pdfDestinationId:string;
  readonly retryDelaysMs:readonly number[];readonly confirmationTimeoutMs:number;
  readonly fingerprint:string;
}

export function freezeSyntheticTransfer(draft:SyntheticDraft,sequence:number):Readonly<SyntheticTransfer> {
  draftSchema.parse(draft);integer.refine(n=>n>0).parse(sequence);
  const settings=validateSyntheticPaths(draft.settings);
  if(!draft.pdf.subarray(0,5).equals(Buffer.from('%PDF-'))||draft.pdf.length>20_000_000)throw Error('INVALID_SYNTHETIC_PDF');
  if(draft.input?.result?.result_type?.trim()==='redraw_notice')throw Error('NOTICE_CHANNEL_HOLD_OD07');
  // Signature check is a contract precondition only; PDF validity/PIC/immutable asset evidence stays P5.
  const operational=draft.mode==='OPERATIONAL_RELEASE';
  if(operational&&!settings.connection)throw Error('OPERATIONAL_DESTINATIONS_REQUIRED');
  const res=operational?serializeOperationalRes(draft.input,draft.profile):serializeSyntheticRes(draft.input as Parameters<typeof serializeSyntheticRes>[0],draft.profile);
  if(!draft.profile.cfsText.trim())throw Error('CFS_TEXT_REQUIRED');
  if(!draft.input.order.specimen_date)throw Error('SPECIMEN_EVIDENCE_REQUIRED');
  if(draft.roundNumber>=2){
    if(!draft.round2Policy)throw Error('ROUND2_SPECIMEN_POLICY_UNRESOLVED');
    const date=draft.round2Policy==='CURRENT_ROUND'?draft.roundSpecimenAt:draft.originalSpecimenAt;
    if(date&&!/^\d{14}$/.test(date))throw Error('INVALID_SPECIMEN_EVIDENCE_DATE');
    if(!date||timestamp(date)!==timestamp(draft.input.order.specimen_date))throw Error('ROUND2_SPECIMEN_MISMATCH');
  }
  const payload={
    mode:operational?'OPERATIONAL_RELEASE' as const:'CONTRACT_ONLY' as const,fixtureId:draft.fixtureId,reportVersionId:draft.reportVersionId,
    roundId:draft.roundId,attemptId:draft.attemptId,origin:draft.origin,
    ln:draft.input.order.ln,lnGeneration:draft.lnGeneration,roundNumber:draft.roundNumber,sequence,epoch:draft.epoch,
    resName:res.filename,pdfName:pdfFilename(draft.input.order.hn,draft.input.order.ln,sequence,draft.profile.pdfTemplate,operational),okName:res.filename.replace(/\.res$/,'.ok'),
    resHash:digest(res.bytes),pdfHash:digest(draft.pdf),resHex:res.bytes.toString('hex'),pdfHex:draft.pdf.toString('hex'),
    profileVersion:draft.profile.version,profileHash:digest(canonical(draft.profile)),settingsVersion:settings.version,settingsHash:digest(canonical(settings)),
    resDestinationId:digest(settings.connection?.resPath??settings.resDirectory),pdfDestinationId:digest(settings.connection?.pdfPath??settings.pdfDirectory),
    retryDelaysMs:Object.freeze([...settings.retryDelaysMs]),confirmationTimeoutMs:settings.confirmationTimeoutMs,
  };
  return Object.freeze({...payload,fingerprint:digest(canonical(payload))});
}

function checkPlan(plan:SyntheticTransfer){
  const {fingerprint,...payload}=plan;
  if(!['CONTRACT_ONLY','OPERATIONAL_RELEASE'].includes(plan.mode)||digest(canonical(payload))!==fingerprint||digest(Buffer.from(plan.resHex,'hex'))!==plan.resHash||digest(Buffer.from(plan.pdfHex,'hex'))!==plan.pdfHash)throw Error('FROZEN_CONTRACT_CHANGED');
}

/** Pure reservation decision over a supplied snapshot. Real atomic lock/unique DB reservation is
 * intentionally NOT implemented here; parallel callers using stale snapshots are not serialized. */
export function reserveSyntheticTransfer(plan:SyntheticTransfer,history:readonly SyntheticTransfer[]) {
  checkPlan(plan);history.forEach(checkPlan);
  const keys=new Set<string>();
  for(const p of history){const k=JSON.stringify([p.ln,p.lnGeneration,p.sequence]);if(keys.has(k))throw Error('INVALID_LEDGER');keys.add(k);}
  const sameKey=(p:SyntheticTransfer)=>p.ln===plan.ln&&p.lnGeneration===plan.lnGeneration;
  const prior=history.find(p=>sameKey(p)&&p.reportVersionId===plan.reportVersionId);
  if(prior){
    if(prior.fingerprint!==plan.fingerprint)throw Error('FROZEN_PAYLOAD_CHANGED');
    return {decision:'REUSE' as const,ledger:history};
  }
  const next=Math.max(0,...history.filter(sameKey).map(p=>p.sequence))+1;
  if(plan.sequence!==next)throw Error('INVALID_SEQUENCE');
  // Compare actual destination identities, independently of settings version/backoff changes;
  // physical path collisions still require
  // exclusive destination create/readback at integration. No "overwrite" operation exists here.
  if(history.some(p=>p.resDestinationId===plan.resDestinationId&&(p.resName===plan.resName||p.okName===plan.okName)||p.pdfDestinationId===plan.pdfDestinationId&&p.pdfName===plan.pdfName))throw Error('DESTINATION_COLLISION');
  return {decision:'NEW' as const,ledger:Object.freeze([...history,plan])};
}

export type TransferState='PREPARED'|'PDF_VERIFIED'|'RES_VERIFIED'|'BACKUP_VERIFIED'|'OK_OBSERVED'|'AWAITING_CONFIRMATION'|'PICKED_UP_UNCONFIRMED'|'UNKNOWN_TIMEOUT'|'SYNTHETIC_CONFIRMED'|'CANCELLED'|'RECONCILIATION_REQUIRED'|'RETRY_PENDING'|'FAILED_NEEDS_ADMIN';
const evidenceSchema=z.strictObject({
  kind:z.enum(['ACK','OPERATOR','QUERY']),transferId:id,pdfHash:sha,resHash:sha,evidenceId:id,actorId:id,observedAt:integer,syntheticOnly:z.literal(true),
});
export type SyntheticEvidence=z.infer<typeof evidenceSchema>;
const eventSchema=z.discriminatedUnion('type',[
  z.strictObject({type:z.literal('PDF_VERIFIED'),sha256:sha}),z.strictObject({type:z.literal('RES_VERIFIED'),sha256:sha}),
  z.strictObject({type:z.literal('BACKUP_VERIFIED'),pdfHash:sha,resHash:sha}),z.strictObject({type:z.literal('OK_OBSERVED'),sha256:sha}),
  z.strictObject({type:z.literal('POST_OK_CHECK')}),z.strictObject({type:z.literal('PICKUP')}),z.strictObject({type:z.literal('TIMEOUT')}),
  z.strictObject({type:z.literal('CONFIRM'),evidence:evidenceSchema}),z.strictObject({type:z.literal('RETRY')}),
  z.strictObject({type:z.literal('WRITE_STARTED'),stage:z.enum(['PDF','RES','BACKUP','OK'])}),
  z.strictObject({type:z.literal('UNEXPECTED_OK')}),
  z.strictObject({type:z.literal('FAILURE'),stage:z.enum(['PDF','RES','BACKUP','OK']),code:z.enum(['IO_ERROR','HASH_MISMATCH','COLLISION','BACKUP_FAILED']),accessCode:z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/).optional()}),
]);
export type TransferEvent=z.infer<typeof eventSchema>;
const gateSchema=z.strictObject({epoch:integer,fixtureEligible:z.boolean(),consentValid:z.boolean(),settingsVersion:id});
export type SyntheticGate=z.infer<typeof gateSchema>;
export interface TransferModel {
  readonly plan:SyntheticTransfer;readonly state:TransferState;readonly attempts:number;readonly startedAt:number;readonly updatedAt:number;
  readonly hisConfirmed:false;readonly reconciliationRequired:boolean;
  readonly artifactsMayExist:boolean;
  readonly resumeState?:TransferState;readonly nextRetryAt?:number;readonly awaitingAt?:number;readonly evidence?:SyntheticEvidence;
  readonly log:readonly {readonly transferId:string;readonly code:string;readonly at:number}[];
}
export function initialTransfer(plan:SyntheticTransfer,now:number):TransferModel {
  checkPlan(plan);integer.parse(now);
  return Object.freeze({plan,state:'PREPARED',attempts:1,startedAt:now,updatedAt:now,hisConfirmed:false,reconciliationRequired:false,artifactsMayExist:false,log:Object.freeze([])});
}
const ordered=['PREPARED','PDF_VERIFIED','RES_VERIFIED','BACKUP_VERIFIED','OK_OBSERVED','AWAITING_CONFIRMATION'] as const;
const expected=['PDF_VERIFIED','RES_VERIFIED','BACKUP_VERIFIED','OK_OBSERVED','POST_OK_CHECK'];
const waiting=['AWAITING_CONFIRMATION','PICKED_UP_UNCONFIRMED','UNKNOWN_TIMEOUT'];

export function advanceTransfer(model:TransferModel,event:TransferEvent,gate:SyntheticGate,now:number):TransferModel {
  checkPlan(model.plan);eventSchema.parse(event);gateSchema.parse(gate);integer.parse(now);
  if(now<model.updatedAt)throw Error('NON_MONOTONIC_TIME');
  const p=model.plan;
  const finish=(patch:Partial<TransferModel>,code:string=event.type):TransferModel=>Object.freeze({...model,...patch,updatedAt:now,hisConfirmed:false,log:Object.freeze([...model.log,Object.freeze({transferId:p.fixtureId,code,at:now})])});
  if(event.type==='UNEXPECTED_OK')return model.state==='RECONCILIATION_REQUIRED'?model:finish({state:'RECONCILIATION_REQUIRED',reconciliationRequired:true,artifactsMayExist:true});
  if(['CANCELLED','RECONCILIATION_REQUIRED','FAILED_NEEDS_ADMIN','SYNTHETIC_CONFIRMED'].includes(model.state))throw Error('INVALID_TRANSITION');
  const index=ordered.indexOf(model.state as typeof ordered[number]);
  const effective=model.state==='RETRY_PENDING'?model.resumeState:model.state;
  const hasFiles=model.artifactsMayExist||effective!=='PREPARED';
  const hasOk=effective==='OK_OBSERVED'||waiting.includes(effective??'');
  if(gate.epoch!==p.epoch||!gate.fixtureEligible||!gate.consentValid||gate.settingsVersion!==p.settingsVersion)
    return finish({state:hasOk?'RECONCILIATION_REQUIRED':'CANCELLED',reconciliationRequired:hasFiles},'GATE_CHANGED');
  if(event.type==='WRITE_STARTED'){
    if(index<0||index>3||event.stage!==['PDF','RES','BACKUP','OK'][index])throw Error('INVALID_TRANSITION');
    return finish({artifactsMayExist:true});
  }
  // Re-observing identical immutable artifacts is idempotent. Always verify proof before reuse.
  const proofIndex=expected.indexOf(event.type);
  if(proofIndex>=0){
    if(event.type==='PDF_VERIFIED'&&event.sha256!==p.pdfHash||event.type==='RES_VERIFIED'&&event.sha256!==p.resHash)throw Error('HASH_MISMATCH');
    if(event.type==='BACKUP_VERIFIED'&&(event.pdfHash!==p.pdfHash||event.resHash!==p.resHash))throw Error('BACKUP_HASH_MISMATCH');
    if(event.type==='OK_OBSERVED'&&event.sha256!==digest(Buffer.from([255,254])))throw Error('OK_HASH_MISMATCH');
    if(index>proofIndex)return model;
  }
  if(event.type==='FAILURE'){
    if(index<0||index>3||event.stage!==['PDF','RES','BACKUP','OK'][index])throw Error('INVALID_TRANSITION');
    if(event.stage==='OK')return finish({state:'RECONCILIATION_REQUIRED',reconciliationRequired:true,artifactsMayExist:true},'AMBIGUOUS_OK_FAILURE');
    if(event.code==='COLLISION'||model.attempts>p.retryDelaysMs.length)return finish({state:'FAILED_NEEDS_ADMIN',reconciliationRequired:true,artifactsMayExist:true},event.code);
    // OWNER-LAB-055: a failure before WRITE_STARTED (e.g. the destination folder is unreachable) cannot have created files; keep that
    // fact so a later folder correction cancels cleanly instead of leaving a permanent "verify files" alarm.
    return finish({state:'RETRY_PENDING',resumeState:model.state,nextRetryAt:now+p.retryDelaysMs[model.attempts-1],artifactsMayExist:model.artifactsMayExist||!(event.type==='FAILURE'&&event.accessCode&&['SHARE_PATH_NOT_FOUND','SHARE_PERMISSION_DENIED'].includes(event.accessCode))},event.code);
  }
  if(event.type==='RETRY'){
    if(model.state!=='RETRY_PENDING'||!model.resumeState||model.nextRetryAt===undefined)throw Error('INVALID_TRANSITION');
    if(now<model.nextRetryAt)throw Error('BACKOFF_PENDING');
    return finish({state:model.resumeState,attempts:model.attempts+1,resumeState:undefined,nextRetryAt:undefined});
  }
  if(index>=0&&index<5&&event.type===expected[index]){
    return finish({state:ordered[index+1],artifactsMayExist:true,...(event.type==='POST_OK_CHECK'?{awaitingAt:now}:{})});
  }
  if(event.type==='PICKUP'&&['AWAITING_CONFIRMATION','PICKED_UP_UNCONFIRMED'].includes(model.state))return finish({state:'PICKED_UP_UNCONFIRMED'});
  if(event.type==='TIMEOUT'&&['AWAITING_CONFIRMATION','PICKED_UP_UNCONFIRMED'].includes(model.state)){
    if(model.awaitingAt===undefined||now<model.awaitingAt+p.confirmationTimeoutMs)throw Error('TIMEOUT_PENDING');
    return finish({state:'UNKNOWN_TIMEOUT',reconciliationRequired:true});
  }
  if(event.type==='CONFIRM'&&waiting.includes(model.state)){
    if(p.mode==='OPERATIONAL_RELEASE')throw Error('HIS_ACK_NOT_IMPLEMENTED');
    const e=event.evidence;
    if(e.transferId!==p.fixtureId||e.resHash!==p.resHash||e.pdfHash!==p.pdfHash||model.awaitingAt===undefined||e.observedAt<model.awaitingAt||e.observedAt>now)throw Error('EVIDENCE_MISMATCH');
    return finish({state:'SYNTHETIC_CONFIRMED',reconciliationRequired:false,evidence:Object.freeze({...e})});
  }
  throw Error('INVALID_TRANSITION');
}

/** Future integration boundary, deliberately closed even for a plausible Released row.
 * PR #5 has no HIS channel and p5_release_authorized() is false. Never cast fixture data into it. */
export function productionReleasedResultAdapter(_candidate:unknown):never {
  void _candidate;
  throw Error('P6_INTEGRATION_HOLD_P5_AL5_AL6');
}
