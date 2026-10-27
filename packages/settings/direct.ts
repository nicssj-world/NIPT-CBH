import type {Queryable} from '../db/connection';
import {appendAudit} from '../db/audit';
import {requirePermission,type Principal} from '../security/policy';
import {SETTINGS,settingDefinition} from './catalog';
import {readActiveSettings} from './service';
import {cancelObsoleteInboundScans} from '../jobs/obsolete-scans';

/**
 * Owner 2026-10-27: system configuration is saved by the APP_ADMIN alone. One transaction validates the change, records an immutable revision and
 * makes it Active. There is no draft, no second approver, no mandatory reason and no worker test queue. The database guard (migration 157)
 * independently verifies that the author holds a current APP_ADMIN assignment; nothing here trusts a role sent by the browser.
 *
 * Not system configuration (they keep their own two-person rules): consent/request mode, doctor registry, result management rules, historical
 * backfill, report interpretation approval and the go-live cutoff. Production authorisation of HIS outbound also keeps its approval.
 */
export const ADMIN_DIRECT_KEYS=['general','security','notifications','report_output','his_inbound','his_outbound','laboratory'] as const;
export type AdminDirectKey=typeof ADMIN_DIRECT_KEYS[number];
export const isAdminDirectKey=(key:string):key is AdminDirectKey=>(ADMIN_DIRECT_KEYS as readonly string[]).includes(key);
export const DEFAULT_REASON='ผู้ดูแลระบบบันทึกการตั้งค่า';

const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v;
const same=(a:unknown,b:unknown)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));

export type SaveOptions={
 reason?:string;
 /** The administrator has seen the first-scan scope and confirmed switching Auto Scan on. */
 confirmFirstScan?:boolean;
 /** Synchronous reachability check for the folders of a HIS setting; throws a stable code when a folder cannot be used. */
 check?:(key:'his_inbound'|'his_outbound',value:Record<string,unknown>)=>Promise<void>;
};
export type SaveResult={saved:boolean;unchanged?:boolean;key:string;version:number;revisionId:string|null;active:true;changedFields:string[]};

const PATH_FIELDS:Record<string,string[]>={his_inbound:['basePath'],his_outbound:['resDestinationPath','pdfDestinationPath','backupPath']};

async function activeRow(db:Queryable,key:string){
 return (await db.query<{id:string;version:number;value:Record<string,unknown>}>("SELECT r.id,r.version,r.value FROM setting_active a JOIN settings_revision r ON r.id=a.revision_id WHERE a.setting_key=$1 AND r.state='Active'",[key])).rows[0]??null;
}

export async function saveSystemSetting(db:Queryable,user:Principal,key:string,value:unknown,options:SaveOptions={}):Promise<SaveResult>{
 if(!isAdminDirectKey(key))throw Error('SETTING_REQUIRES_APPROVAL');
 requirePermission(user,'settings.general.change',{},'write');
 if(key==='his_inbound'||key==='his_outbound')requirePermission(user,'integration.configure',{},'write');
 const d=settingDefinition(key);
 const next=d.schema.parse(value) as Record<string,unknown>;
 const reason=(options.reason??'').trim()||DEFAULT_REASON;
 if(reason.length>250)throw Error('REASON_TOO_LONG');
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`settings:${key}`]);
 const active=await activeRow(db,key);
 const before=(active?.value??(SETTINGS[key].default as Record<string,unknown>));
 // Controlled laboratory metadata is read-only here exactly as in the approval flow.
 if(key==='laboratory')for(const field of ['templateVersion','formulaVersion'])if(next[field]!==before[field])throw Error('CONTROLLED_METADATA_READ_ONLY');
 if(key==='his_outbound'&&next.productionAuthorized===true&&before.productionAuthorized!==true)throw Error('PRODUCTION_AUTHORIZATION_REQUIRES_APPROVAL');
 if(same(before,next))return {saved:false,unchanged:true,key,version:active?.version??0,revisionId:active?.id??null,active:true,changedFields:[]};
 const changedFields=Object.keys({...before,...next}).filter(f=>!same(before[f],next[f])).sort();
 // Switching Auto Scan on starts reading the HIS folder; the administrator must have seen what will be scanned.
 if(key==='his_inbound'&&next.enabled===true&&before.enabled!==true&&options.confirmFirstScan!==true)throw Error('SCAN_SCOPE_CONFIRMATION_REQUIRED');
 // Folders are checked now, in this request; a folder that cannot be used refuses the save instead of saving something that cannot work.
 if((key==='his_inbound'||key==='his_outbound')&&options.check&&changedFields.some(f=>PATH_FIELDS[key].includes(f)))await options.check(key,next);
 const inserted=(await db.query<{id:string;version:number}>(`INSERT INTO settings_revision(setting_key,version,category,risk,value,state,created_by,reason,previous_revision_id,test_passed)
  VALUES($1,(SELECT COALESCE(max(version),0)+1 FROM settings_revision WHERE setting_key=$1),$2,$3,$4,'Validated',$5,$6,$7,true) RETURNING id,version`,
  [key,d.category,d.risk,JSON.stringify(next),user.id,reason,active?.id??null])).rows[0];
 await db.query("UPDATE settings_revision SET state='Archived' WHERE setting_key=$1 AND state='Active'",[key]);
 await db.query('INSERT INTO setting_active(setting_key,revision_id) VALUES($1,$2) ON CONFLICT(setting_key) DO UPDATE SET revision_id=excluded.revision_id',[key,inserted.id]);
 await db.query("UPDATE settings_revision SET state='Active' WHERE id=$1",[inserted.id]);
 if(key==='his_inbound')await cancelObsoleteInboundScans(db,user.id);
 // The audit chain carries identifiers only (actor, time, setting key, revision, outcome); the old and the new values are the two immutable revisions it points to.
 await appendAudit(db,{actorId:user.id,action:'SETTING_SAVED_ACTIVE',resourceType:'SETTING',resourceId:inserted.id,details:{outcome:'ACTIVE',version:inserted.version,reasonCode:key,count:changedFields.length}});
 return {saved:true,key,version:inserted.version,revisionId:inserted.id,active:true,changedFields};
}

export type ScanScope={enabled:boolean;alreadyEnabled:boolean;lookbackDays:number;intervalSeconds:number;basePath:string;dayFolders:number|null;pairedPetFiles:number|null;petFiles:number|null;sampleParse:string|null;accessible:boolean;errorCode:string|null};
/** What switching Auto Scan on would read: folder, look-back window, interval and the PET+OK pairs found now. Read-only. */
export async function inboundScanScope(db:Queryable,value:unknown,probe:(value:Record<string,unknown>)=>Promise<{passed:boolean;dayFolders:number;petFiles:number;pairedPetFiles:number;sampleParse:string;errorCode:string|null}>):Promise<ScanScope>{
 const next=SETTINGS.his_inbound.schema.parse(value);
 const current=(await readActiveSettings(db)).his_inbound as {enabled?:boolean}|undefined;
 const base:ScanScope={enabled:next.enabled,alreadyEnabled:current?.enabled===true,lookbackDays:next.lookbackDays,intervalSeconds:next.intervalSeconds,basePath:next.basePath,dayFolders:null,pairedPetFiles:null,petFiles:null,sampleParse:null,accessible:false,errorCode:null};
 try{const r=await probe(next);return {...base,accessible:r.errorCode===null||r.dayFolders>0,dayFolders:r.dayFolders,petFiles:r.petFiles,pairedPetFiles:r.pairedPetFiles,sampleParse:r.sampleParse,errorCode:r.errorCode};}
 catch(e){return {...base,errorCode:e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'SCOPE_CHECK_FAILED'};}
}
