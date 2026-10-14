import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {lockLn} from '../db/registration';
import {appendAudit} from '../db/audit';
import {FileStore} from '../storage';
import {parsePet} from '../integrations/pet';
import {assertOutboundOrigin} from '../historical/barrier';
import {operationalDataEnabled} from '../security/runtime';
import {activeHis,outboundDraftSettings} from '../settings/his';
import {SETTINGS} from '../settings/catalog';
import type {Parsed} from '../results/parser';
import {freezeSyntheticTransfer,initialTransfer,type SyntheticDraft} from './transfer';
import {transaction,loadTransfer,type StoredDraft} from './journal';

export const RELEASE_OUTBOUND_JOB='result_release_completed';
const wireTime=(date:Date)=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(date).replace(/[- :]/g,'');
export async function operationalReleaseEligible(db:Queryable,id:string,epoch:number){
 return (await db.query<{eligible:boolean}>('SELECT p6_release_eligible($1,$2) eligible',[id,epoch])).rows[0]?.eligible===true;
}
/** Executed by the existing worker for a committed P5 release event. No fixture enrollment or alternative publisher. */
export async function reserveReleasedResult(db:Queryable,releaseId:string,store:FileStore){
 if(!operationalDataEnabled())throw Error('OPERATIONAL_MODE_REQUIRED');z.uuid().parse(releaseId);
 return transaction(db,async()=>{
  const head=(await db.query<{ln:string}>('SELECT l.ln FROM result_release r JOIN specimen_round s ON s.id=r.round_id JOIN case_ln l ON l.id=s.case_ln_id WHERE r.id=$1',[releaseId])).rows[0];
  if(!head)throw Error('RELEASE_NOT_FOUND');await lockLn(db,head.ln);
  const r=(await db.query<{id:string;epoch:number;version_id:string;round_id:string;attempt_id:string;certified_by:string;certified_at:Date;sha256:string;parsed:Parsed;registration_origin:'ANC'|'LAB_DIRECT';round_number:number;version:number;case_ln_id:string}>(`SELECT r.id,r.epoch,r.version_id,r.round_id,r.certified_by,r.certified_at,v.attempt_id,v.sha256,v.parsed,c.registration_origin,s.round_number,s.case_ln_id,l.version
   FROM result_release r JOIN result_report_version v ON v.id=r.version_id JOIN nipt_case c ON c.id=r.case_id JOIN specimen_round s ON s.id=r.round_id JOIN case_ln l ON l.id=s.case_ln_id WHERE r.id=$1 FOR UPDATE OF r`,[releaseId])).rows[0];
  if(!r||!await operationalReleaseEligible(db,releaseId,r.epoch))throw Error('CERTIFIED_CURRENT_RELEASE_REQUIRED');
  assertOutboundOrigin(r.registration_origin);
  const previous=(await db.query<{id:string}>('SELECT id FROM p6_transfer WHERE clinical_release_id=$1',[releaseId])).rows[0];if(previous)return loadTransfer(db,previous.id);
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['settings:his_outbound']);
  const active=await activeHis(db,'his_outbound'),s=SETTINGS.his_outbound.schema.parse(active.value);
  if(!s.enabled||s.target!=='AUTHORIZED_SHARE'||!s.productionAuthorized||!s.resProfile)throw Error('OPERATIONAL_OUTBOUND_CONFIGURATION_REQUIRED');
  const certifier=s.certifierHisMappings[r.certified_by];if(!certifier)throw Error('CERTIFIER_HIS_MAPPING_REQUIRED');
  if(r.round_number>1&&!s.round2SpecimenDatePolicy)throw Error('ROUND2_SPECIMEN_POLICY_UNRESOLVED');
  const order=(await db.query<{sha256:string;filename:string}>(`SELECT f.sha256,f.filename FROM his_order o JOIN his_inbound_file f ON f.id=o.inbound_file_id JOIN specimen_round x ON x.id=o.round_id
   WHERE o.case_ln_id=$1 AND x.round_number=$2`,[r.case_ln_id,r.round_number>1&&s.round2SpecimenDatePolicy==='ORIGINAL_ORDER'?1:r.round_number])).rows[0];
  if(!order)throw Error('ROUND_PET_EVIDENCE_REQUIRED');
  const pet=parsePet(await store.get(order.sha256),order.filename);
  const timestamp=(s:string)=>s.slice(0,19).replace(/[-T:]/g,'');
  const name=pet.name.split('^^'),dspname=name.length===2?`${name[1].trim()} ${name[0].trim()}`:pet.name;
  const fields=r.parsed.results,result=Object.fromEntries([['t21',fields.t21.value],['t18',fields.t18.value],['t13',fields.t13.value],['sex_xo',fields.xo.value],['sex_xxx',fields.xxx.value],['sex_xxy',fields.xxy.value],['sex_xyy',fields.xyy.value]].filter(([,v])=>v!==null)) as Record<string,string>;
  const now=wireTime(new Date()),specimenAt=timestamp(pet.specimenAt);
  const draft:SyntheticDraft={mode:'OPERATIONAL_RELEASE',fixtureId:'RELEASE-'+releaseId,reportVersionId:r.version_id,roundId:r.round_id,attemptId:r.attempt_id,origin:r.registration_origin,lnGeneration:r.version,roundNumber:r.round_number,epoch:r.epoch,
   input:{order:{ln:pet.ln,hn:pet.hn,dspname,dob:pet.dob.slice(0,10).replaceAll('-',''),sex:pet.sex as 'F'|'M'|'U',specimen_date:specimenAt},generatedAt:now,approvedAt:wireTime(new Date(r.certified_at)),certifierHisId:certifier,result},
   profile:{...s.resProfile,style:s.resultStyle},pdf:await store.get(r.sha256),settings:outboundDraftSettings(active),
   ...(r.round_number>1?{round2Policy:s.round2SpecimenDatePolicy!,roundSpecimenAt:specimenAt,originalSpecimenAt:specimenAt}:{})};
  const n=(await db.query<{n:number}>('SELECT coalesce(max(sequence),0)::int+1 n FROM p6_transfer WHERE ln=$1 AND ln_generation=$2',[pet.ln,r.version])).rows[0].n;
  const plan=freezeSyntheticTransfer(draft,n),model=initialTransfer(plan,Date.now()),gate={epoch:r.epoch,fixtureEligible:true,consentValid:true,settingsVersion:plan.settingsVersion};
  const {pdf,...rest}=draft,stored:StoredDraft={...rest,pdfHex:pdf.toString('hex')};
  const id=(await db.query<{id:string}>(`INSERT INTO p6_transfer(fixture_id,sandbox_id,authority,clinical_release_id,release_draft,ln,ln_generation,report_version_id,sequence,res_destination,pdf_destination,res_name,pdf_name,plan,model,gate)
   VALUES(NULL,'OPERATIONAL','CERTIFIED_RESULT',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,[releaseId,stored,plan.ln,plan.lnGeneration,r.version_id,n,plan.resDestinationId,plan.pdfDestinationId,plan.resName,plan.pdfName,plan,model,gate])).rows[0].id;
  await db.query("INSERT INTO p6_transfer_event(transfer_id,revision,code,event) VALUES($1,0,'RESERVED',$2)",[id,{releaseId}]);
  await appendAudit(db,{action:'P6_RELEASE_RESERVED',resourceType:'p6_transfer',resourceId:id,details:{synthetic:false,outcome:'PREPARED'}});
  return loadTransfer(db,id);
 });
}
