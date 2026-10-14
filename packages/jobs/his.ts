import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {appendAudit} from '../db/audit';
import type {FileStore} from '../storage';
import {SETTINGS} from '../settings/catalog';
import {activeHis,assertHisVersion} from '../settings/his';
import {openInboundSource} from '../inbound/source';
import {simulatorRoot} from '../integrations/scanner';
import {runInboundCycle} from '../inbound/cycle';
import {testInboundConnection} from '../inbound/connection-test';
export const scanPayloadSchema=z.object({trigger:z.enum(['INTERVAL','MANUAL','DEEP']).optional(),lookbackDays:z.number().int().min(1).max(90).optional(),actorId:z.uuid().optional(),configurationId:z.uuid().optional()}).strict().refine(p=>p.trigger!=='DEEP'||p.lookbackDays!==undefined,'DEEP_SCAN_LOOKBACK_REQUIRED');
/** This is the handler used by the running Worker, not a second simulator scanner. */
export async function executeInboundJob(db:Queryable,kind:'synthetic_scan'|'synthetic_inbound_test',payload:unknown,store:FileStore,lookupKey?:Buffer){
 const row=await activeHis(db,'his_inbound'),s=SETTINGS.his_inbound.schema.parse(row.value),p=scanPayloadSchema.parse(payload??{});
 if(p.configurationId&&p.configurationId!==row.id)throw Error('HIS_CONFIGURATION_CHANGED');
 if(kind==='synthetic_scan'&&!s.enabled)throw Error('SCAN_DISABLED');
 const opened=await openInboundSource(s.basePath,s.secretRef),version=()=>assertHisVersion(db,'his_inbound',row.id);
 const source={...opened,assert:async()=>{await version();await opened.assert();},file:async(relative:string)=>{await version();return opened.file(relative);}};
 const root=s.basePath==='simulator/inbound'?simulatorRoot():s.basePath;
 await appendAudit(db,{actorId:p.actorId,action:'INBOUND_CONFIGURATION_USED',resourceType:'SETTING',resourceId:row.id,details:{version:row.version,synthetic:true}});
 if(kind==='synthetic_inbound_test')return {...await testInboundConnection(root,{source,lookbackDays:s.lookbackDays}),configurationId:row.id,configurationVersion:row.version};
 if(!lookupKey)throw Error('INBOUND_LOOKUP_KEY_REQUIRED');const trigger=p.trigger??'INTERVAL';
 const r=await runInboundCycle(db,{store,lookupKey,root,source},{trigger,lookbackDays:trigger==='DEEP'?p.lookbackDays!:s.lookbackDays,intervalSeconds:s.intervalSeconds,actorId:p.actorId});
 return {outcome:r.outcome,counts:r.counts,configurationId:row.id,configurationVersion:row.version};
}
