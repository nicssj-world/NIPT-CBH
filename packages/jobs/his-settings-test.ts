import {randomUUID,createHash} from 'node:crypto';
import * as fs from 'node:fs/promises';
import {operationalDataEnabled} from '../security/runtime';
import type {Queryable} from '../db/connection';
import {appendAudit} from '../db/audit';
import {SETTINGS} from '../settings/catalog';
import {assertHisVersion,outboundDraftSettings,type ActiveHis} from '../settings/his';
import {openInboundSource} from '../inbound/source';
import {testInboundConnection} from '../inbound/connection-test';
import {shareError,openAuthorizedDirectory,workerServiceAccount} from '../integrations/authorized-share';
import {freezeSyntheticTransfer} from '../p6/transfer';
import {syntheticProfile} from '../p6/res';
import {transaction} from '../p6/journal';
import {openSandbox} from '../p6/sandbox';
export async function runHisSettingsTest(db:Queryable,payload:unknown){
 const p=payload as {revisionId?:string;version?:number;active?:boolean};
 const row=(await db.query<ActiveHis&{state:string}>('SELECT id,setting_key,version,value,state FROM settings_revision WHERE id=$1',[p.revisionId])).rows[0];
 if(!row||row.version!==p.version||!['his_inbound','his_outbound'].includes(row.setting_key))throw Error('HIS_CONFIGURATION_CHANGED');
 // A queued test whose revision was superseded (activated, archived or replaced since) is finished with a plain result. Throwing here would leave a sticky
 // worker error in the health report for a test nobody is waiting for any more (Owner 2026-10-27: settings no longer depend on this queue).
 if(row.state!==(p.active?'Active':'Draft'))return {passed:false,errorCode:'HIS_CONFIGURATION_CHANGED',superseded:true,revisionId:row.id,version:row.version,workerAccount:null,syntheticOnly:!operationalDataEnabled()};
 let report:Record<string,unknown>;
 try{
  if(p.active)await assertHisVersion(db,row.setting_key,row.id);
  if(row.setting_key==='his_inbound'){
   const s=SETTINGS.his_inbound.schema.parse(row.value),source=await openInboundSource(s.basePath,s.secretRef);
   const root=s.basePath==='simulator/inbound'?(await import('../integrations/scanner')).simulatorRoot():s.basePath;
   report={...await testInboundConnection(root,{source,lookbackDays:s.lookbackDays})};
  }else if(operationalDataEnabled()){
   const s=SETTINGS.his_outbound.schema.parse(row.value),checks=[];
   for(const input of [s.resDestinationPath,s.pdfDestinationPath,s.backupPath]){
    const directory=await openAuthorizedDirectory(input,'OUTBOUND',s.secretRef),name='.nipt-connection-probe-'+randomUUID();
    const filename=await directory.file(name,true),bytes=Buffer.from('NIPT CONNECTION PROBE\n');let created=false;
    try{const h=await fs.open(filename,'wx',0o600);created=true;try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}
     if(!(await fs.readFile(await directory.file(name))).equals(bytes))throw Error('SHARE_READBACK_MISMATCH');checks.push({readWriteVerified:true});
    }finally{if(created)await fs.unlink(await directory.file(name));}
   }
   report={passed:true,code:'CONNECTION_ACL_READBACK_VERIFIED',checks,hisConfirmed:false};
  }else{
   const s=SETTINGS.his_outbound.schema.parse(row.value),settings=outboundDraftSettings(row),tag='SYNTHETIC-TEST-'+randomUUID();
   if(!settings.connection&&s.secretRef!==null)throw Error('SHARE_CREDENTIAL_REFERENCE_MISMATCH');
   const n=createHash('sha256').update(tag).digest('hex').slice(0,10),ln='99000'+BigInt('0x'+n).toString();
   const plan=freezeSyntheticTransfer({fixtureId:tag,reportVersionId:tag,roundId:tag,attemptId:tag,origin:'LAB_DIRECT',lnGeneration:1,roundNumber:1,epoch:0,input:{order:{ln,hn:tag,dspname:'SYNTHETIC TEST',dob:'20000101',sex:'F',specimen_date:'20261014070000'},result:null,generatedAt:'20261014080000',approvedAt:'20261014080000',certifierHisId:'SYNTHETIC^SYNTHETIC'},profile:{...syntheticProfile,style:s.resultStyle},pdf:Buffer.from('%PDF-1.4\n% SYNTHETIC CONNECTION PROBE\n%%EOF'),settings},1);
   const transport=await openSandbox(tag,settings,undefined,async publish=>{if(!p.active)return publish();await transaction(db,async()=>{await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['settings:his_outbound']);await assertHisVersion(db,row.setting_key,row.id);await publish();});});
   for(const a of ['PDF','RES','BACKUP','OK'] as const)await transport.ensure(a,plan);
   report={passed:true,code:'SYNTHETIC_TRANSFER_VERIFIED',backupVerified:await transport.backupVerified(plan),hisConfirmed:false};
  }
 }catch(e){report={passed:false,errorCode:shareError(e)};}
 if(p.active)try{await assertHisVersion(db,row.setting_key,row.id);}catch{report={passed:false,errorCode:'HIS_CONFIGURATION_CHANGED'};}
 // Worker supplies an autocommit PoolClient. Own only this short audit
 // transaction, after connection probes/publication transactions have finished.
 await transaction(db,()=>appendAudit(db,{action:'HIS_SETTINGS_TEST_COMPLETED',resourceType:'SETTING',resourceId:row.id,details:{version:row.version,outcome:report.passed?'PASSED':'FAILED',synthetic:!operationalDataEnabled()}}));
 // OWNER-LAB-055/059: the report names the identity that actually tested the folders (the worker's service account).
 let workerAccount:string|null=null;try{workerAccount=workerServiceAccount();}catch{/* identity unavailable */}
 return {...report,workerAccount,revisionId:row.id,version:row.version,syntheticOnly:!operationalDataEnabled()};
}
