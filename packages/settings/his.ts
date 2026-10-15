import {randomUUID} from 'node:crypto';
import {operationalDataEnabled} from '../security/runtime';
import type {Queryable} from '../db/connection';
import {appendAudit} from '../db/audit';
import {requirePermission,type Principal} from '../security/policy';
import {SETTINGS} from './catalog';
import {validateSetting} from './service';
import type {SyntheticDraft} from '../p6/transfer';
export const HIS_TEST_KIND='synthetic_settings_test';
type HisKey='his_inbound'|'his_outbound';
export type ActiveHis={id:string;version:number;setting_key:HisKey;value:unknown};
export async function activeHis(db:Queryable,key:HisKey):Promise<ActiveHis>{
 const row=(await db.query<ActiveHis>("SELECT r.id,r.version,r.setting_key,r.value FROM setting_active a JOIN settings_revision r ON r.id=a.revision_id WHERE a.setting_key=$1 AND r.state='Active'",[key])).rows[0];
 if(!row)throw Error('HIS_ACTIVE_SETTINGS_REQUIRED');return row;
}
export async function assertHisVersion(db:Queryable,key:HisKey,id:string){if((await activeHis(db,key)).id!==id)throw Error('HIS_CONFIGURATION_CHANGED');}
export async function requestHisTest(db:Queryable,user:Principal,id:string,active=false){
 requirePermission(user,'integration.configure',{},'write');
 const row=(await db.query<ActiveHis&{state:string;created_by:string}>('SELECT id,setting_key,version,value,state,created_by FROM settings_revision WHERE id=$1 FOR UPDATE',[id])).rows[0];
 if(!row||!['his_inbound','his_outbound'].includes(row.setting_key)||(!active&&(row.state!=='Draft'||row.created_by!==user.id)))throw Error('SETTING_DRAFT_REQUIRED');
 if(active){if(row.state!=='Active')throw Error('HIS_ACTIVE_SETTINGS_REQUIRED');await assertHisVersion(db,row.setting_key,id);}

 const previous=!active?(await db.query<{id:string;result:Record<string,unknown>|null}>("SELECT j.id,r.result FROM job_outbox j LEFT JOIN integration_job_receipt r ON r.outbox_id=j.id WHERE j.kind=$1 AND j.payload->>'revisionId'=$2 AND j.payload->>'active'='false' ORDER BY j.created_at DESC LIMIT 1",[HIS_TEST_KIND,id])).rows[0]:undefined;
 if(previous?.result?.passed===true&&previous.result.revisionId===id&&previous.result.version===row.version){await validateSetting(db,user,id,async()=>true);return {id,jobId:previous.id,queued:false,report:previous.result};}
 if(previous&&!previous.result)return {id,jobId:previous.id,queued:true};
 const r=await db.query<{id:string}>("INSERT INTO job_outbox(kind,payload,idempotency_key) VALUES($1,$2,$3) RETURNING id",[HIS_TEST_KIND,{revisionId:id,version:row.version,active},'his-setting-test:'+randomUUID()]);
 const jobId=r.rows[0].id;
 await appendAudit(db,{actorId:user.id,action:'HIS_SETTINGS_TEST_QUEUED',resourceType:'SETTING',resourceId:id,details:{version:row.version,synthetic:true}});
 return {id,jobId,queued:true};
}
export function outboundDraftSettings(row:ActiveHis){
 const s=SETTINGS.his_outbound.schema.parse(row.value),paths=[s.resDestinationPath,s.pdfDestinationPath,s.backupPath];
 const defaults=['simulator/p6/res','simulator/p6/cfs','simulator/p6/backup'];
 const local=paths.every((p,i)=>p===defaults[i]);if(!local&&paths.some(p=>p.startsWith('simulator/')))throw Error('HIS_MIXED_DESTINATIONS_PROHIBITED');
 return {version:(operationalDataEnabled()?'OPERATIONAL-SETTINGS-':'SYNTHETIC-SETTINGS-')+row.id,resDirectory:defaults[0],pdfDirectory:defaults[1],backupDirectory:defaults[2],retryDelaysMs:Array.from({length:s.retryLimit},(_,i)=>Math.min(86400000,s.retryDelaySeconds*1000*2**i)),confirmationTimeoutMs:s.confirmationTimeoutSeconds*1000,
  ...(!local?{connection:{revisionId:row.id,resPath:paths[0],pdfPath:paths[1],backupPath:paths[2],secretRef:s.secretRef}}:{})};
}
/** Called only by existing fixture-enrollment tooling. Never accepts a P5 release as fixture data. */
export async function bindActiveOutboundSettings(db:Queryable,draft:SyntheticDraft):Promise<SyntheticDraft>{
 const row=await activeHis(db,'his_outbound'),s=SETTINGS.his_outbound.schema.parse(row.value);if(!s.enabled)throw Error('EXPORT_DISABLED');
 return {...draft,settings:outboundDraftSettings(row),profile:{...draft.profile,style:s.resultStyle}};
}
