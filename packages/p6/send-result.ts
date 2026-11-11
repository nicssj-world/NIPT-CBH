import {randomUUID} from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {appendAudit} from '../db/audit';
import {FileStore} from '../storage';
import {parsePet} from '../integrations/pet';
import {openAuthorizedDirectory,shareError} from '../integrations/authorized-share';
import {simulatorRoot} from '../integrations/scanner';
import {assertOutboundOrigin} from '../historical/barrier';
import {operationalDataEnabled} from '../security/runtime';
import {activeHis} from '../settings/his';
import {SETTINGS} from '../settings/catalog';
import {reportDownloadName} from '../readygen/report-name';
import type {Parsed} from '../results/parser';
import {serializeOperationalRes} from './res';
import {releaseOrderFromPet,releaseResultFromParsed} from './released-result';

// Owner 2026-11-11: "ส่ง HIS" = write the PDF into the CFS folder, then the .res and the .ok into the RES folder. Nothing else:
// no backup copy, no confirmation wait, no simulator/production switch, no frozen transfer. A failure is recorded with its reason
// and the user sends again with the "ส่ง HIS อีกครั้ง" button (a new job), which simply writes the files again.

export type SendOutcome={sent:true;sentAt:string;pdfName:string;resName:string;okName:string;resend:boolean}|{sent:false;error:string;resend:boolean}|{suppressed:'HIS_PRESENCE_ATTESTED';hisConfirmed:false};

const wireTime=(date:Date)=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(date).replace(/[- :]/g,'');
const errorCode=(e:unknown)=>{const c=shareError(e);return /^[A-Z][A-Z0-9_]{1,63}$/.test(c)?c:'SEND_FAILED';};

/** A destination folder: in operational runtime the saved absolute path (same checks as Settings: safe path, existing folder, no link,
 *  not a system folder). In development/synthetic runtime a relative path stays inside the simulator root and an absolute one needs the
 *  synthetic share policy, so development never writes a hospital folder. */
async function destination(input:string,secretRef:string|null){
 if(!operationalDataEnabled()&&!path.isAbsolute(input)){
  if(input.split(/[\\/]/).some(s=>!s||s==='.'||s==='..'))throw Error('UNSAFE_SHARE_PATH');
  const base=path.resolve(simulatorRoot(),...input.split(/[\\/]/));
  await fs.mkdir(base,{recursive:true});
  return (name:string)=>path.join(base,name);
 }
 const dir=await openAuthorizedDirectory(input,'OUTBOUND',secretRef);
 return (name:string)=>path.join(dir.base,name);
}
/** Write next to the destination and rename over it, so a reader never sees half a file. Re-sending replaces the old file. */
async function put(file:(name:string)=>string,name:string,bytes:Buffer){
 if(!name||/[\\/:*?"<>|\r\n\0]/.test(name))throw Error('UNSAFE_FILENAME');
 const temp=file(`.${name}.${randomUUID()}.part`),target=file(name);
 try{await fs.writeFile(temp,bytes);await fs.rename(temp,target);}
 finally{await fs.unlink(temp).catch(()=>undefined);}
}

/** Executed by the worker for a "ส่ง HIS" job. Never throws for a send problem: the outcome (sent or the reason) is the job result. */
export async function sendReleasedResult(db:Queryable,releaseId:string,store:FileStore,options:{resend?:boolean}={}):Promise<SendOutcome>{
 z.uuid().parse(releaseId);const resend=options.resend===true;
 try{
  const r=(await db.query<{epoch:number;state:string;version_id:string;certified_by:string;certified_at:Date;sha256:string;parsed:Parsed;registration_origin:string;round_number:number;case_ln_id:string;eqa:boolean;attested:boolean}>(
   `SELECT r.epoch,r.state,r.version_id,r.certified_by,r.certified_at,v.sha256,v.parsed,c.registration_origin,s.round_number,s.case_ln_id,
     EXISTS(SELECT 1 FROM eqa_case e WHERE e.case_id=r.case_id) eqa,task3_his_presence_attested(v.id) attested
    FROM result_release r JOIN result_report_version v ON v.id=r.version_id JOIN nipt_case c ON c.id=r.case_id JOIN specimen_round s ON s.id=r.round_id WHERE r.id=$1`,[releaseId])).rows[0];
  if(!r)return {sent:false,error:'RELEASE_NOT_FOUND',resend};
  if(r.eqa)return {sent:false,error:'EQA_NO_HIS_OUTBOUND',resend};
  if(r.attested)return {suppressed:'HIS_PRESENCE_ATTESTED',hisConfirmed:false};
  if(r.state!=='Active')return {sent:false,error:'RELEASE_NOT_ACTIVE',resend};
  assertOutboundOrigin(r.registration_origin);
  const s=SETTINGS.his_outbound.schema.parse((await activeHis(db,'his_outbound')).value);
  if(!s.resProfile)return {sent:false,error:'RES_PROFILE_REQUIRED',resend};
  const certifier=s.operatorHisId??s.certifierHisMappings[r.certified_by];if(!certifier)return {sent:false,error:'CERTIFIER_HIS_MAPPING_REQUIRED',resend};
  const order=(await db.query<{sha256:string;filename:string}>(`SELECT f.sha256,f.filename FROM his_order o JOIN his_inbound_file f ON f.id=o.inbound_file_id JOIN specimen_round x ON x.id=o.round_id
   WHERE o.case_ln_id=$1 AND x.round_number=$2`,[r.case_ln_id,r.round_number>1&&s.round2SpecimenDatePolicy==='ORIGINAL_ORDER'?1:r.round_number])).rows[0];
  if(!order)return {sent:false,error:'ROUND_PET_EVIDENCE_REQUIRED',resend};
  const pet=parsePet(await store.get(order.sha256),order.filename);
  const res=serializeOperationalRes({order:releaseOrderFromPet(pet),generatedAt:wireTime(new Date()),approvedAt:wireTime(new Date(r.certified_at)),certifierHisId:certifier,result:releaseResultFromParsed(r.parsed)},{...s.resProfile,style:s.resultStyle});
  const pdfName=await reportDownloadName(db,r.version_id),okName=res.filename.replace(/\.res$/i,'.ok');
  const pdfFolder=await destination(s.pdfDestinationPath,s.secretRef),resFolder=await destination(s.resDestinationPath,s.secretRef);
  // PDF first, then RES; the OK is written last because it tells HIS the RES is complete.
  await put(pdfFolder,pdfName,await store.get(r.sha256));
  await put(resFolder,res.filename,res.bytes);
  await put(resFolder,okName,res.ok);
  await appendAudit(db,{action:resend?'HIS_RESULT_RESENT':'HIS_RESULT_SENT',resourceType:'result_release',resourceId:releaseId,details:{outcome:'SENT'}});
  return {sent:true,sentAt:new Date().toISOString(),pdfName,resName:res.filename,okName,resend};
 }catch(e){return {sent:false,error:errorCode(e),resend};}
}
