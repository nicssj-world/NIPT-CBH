import type {Queryable} from '../db/connection';
import {appendAudit} from '../db/audit';
import {requirePermission,type Principal} from '../security/policy';
import {SETTINGS} from './catalog';
import {validateSetting,readActiveSettings} from './service';
import {requestHisTest,HIS_TEST_KIND} from './his';
import {cancelObsoleteInboundScans} from '../jobs/obsolete-scans';

/**
 * OWNER-LAB-055/059 (Owner final lock 2026-10-25): an administrator corrects the HIS folders in Settings and the running
 * scanner/worker uses them on its next job — no source, file, registry or environment edit, rebuild, reinstall or restart.
 * Only PATH fields change here; every other HIS/result setting (enabling live I/O, production authorisation, profiles,
 * clinical rules) keeps its existing two-person approval. A change is applied only after the worker (the service identity
 * that will use the folder) has tested it; every revision is versioned and audited and the previous revision is restorable.
 */
export const HIS_PATH_FIELDS={his_inbound:{basePath:'pet'},his_outbound:{resDestinationPath:'res',pdfDestinationPath:'cfsPdf',backupPath:'backup'},result_management:{pdfSourcePath:'externalPdf'}} as const;
type PathKey=keyof typeof HIS_PATH_FIELDS;
export type HisPathName='pet'|'res'|'cfsPdf'|'backup'|'externalPdf';
const KEYS=Object.keys(HIS_PATH_FIELDS) as PathKey[];
const REASON_PREFIX='HIS path change: ';
type Row={id:string;setting_key:PathKey;version:number;value:Record<string,unknown>;state:string;created_by:string;test_passed:boolean;previous_revision_id:string|null;reason:string;created_at:Date};

async function current(db:Queryable,key:PathKey){
 const active=(await db.query<Row>("SELECT r.* FROM setting_active a JOIN settings_revision r ON r.id=a.revision_id WHERE a.setting_key=$1 AND r.state='Active'",[key])).rows[0]??null;
 return {active,value:(active?.value??SETTINGS[key].default) as Record<string,unknown>};
}
const pathsOf=(key:PathKey,value:Record<string,unknown>)=>Object.fromEntries(Object.entries(HIS_PATH_FIELDS[key]).map(([field,name])=>[name,String(value[field]??'')])) as Partial<Record<HisPathName,string>>;
// Canonical (deep key-sorted) JSON: jsonb and zod emit nested object keys in different orders.
const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v;
const withoutPaths=(key:PathKey,value:Record<string,unknown>)=>JSON.stringify(canonical(Object.fromEntries(Object.entries(value).filter(([k])=>!(k in HIS_PATH_FIELDS[key])))));

async function testState(db:Queryable,row:Row){
 if(row.setting_key==='result_management')return row.test_passed?{state:'PASSED'}:{state:'FAILED',errorCode:'RESULT_FOLDER_NOT_ACCESSIBLE'};
 const job=(await db.query<{id:string;result:Record<string,unknown>|null}>("SELECT j.id,r.result FROM job_outbox j LEFT JOIN integration_job_receipt r ON r.outbox_id=j.id WHERE j.kind=$1 AND j.payload->>'revisionId'=$2 ORDER BY j.created_at DESC LIMIT 1",[HIS_TEST_KIND,row.id])).rows[0];
 if(!job)return {state:'NOT_TESTED'};if(!job.result)return {state:'RUNNING',jobId:job.id};
 if(job.result.passed===true)return {state:'PASSED',jobId:job.id,report:job.result};
 // A readable PET root that simply has no YYYYMMDD folder / PET yet (new server, just after midnight) is a valid folder:
 // accepted with a visible warning. PET files that exist but cannot be read or parsed still fail.
 const checks=(job.result.checks??[]) as {code:string;passed:boolean}[],ok=(c:string)=>checks.some(x=>x.code===c&&x.passed);
 if(row.setting_key==='his_inbound'&&ok('INBOUND_DIRECTORY')&&Number(job.result.petFiles??-1)===0&&checks.every(x=>x.passed||['DAY_FOLDERS_FOUND','PET_OK_PAIR_FOUND','SAMPLE_PARSE'].includes(x.code)))
  return {state:'PASSED',jobId:job.id,warning:'INBOUND_FOLDER_EMPTY',report:job.result};
 return {state:'FAILED',jobId:job.id,errorCode:String(job.result.errorCode??'TEST_FAILED'),report:job.result};
}

/** Active paths (or operational defaults when nothing was ever activated) and this administrator's pending change. */
export async function hisPathOverview(db:Queryable,user:Principal){
 requirePermission(user,'integration.configure',{},'read');
 const out:Record<string,unknown>={};
 for(const key of KEYS){
  const c=await current(db,key);
  // Pending = this administrator's LATEST test batch only (one transaction, one created_at); older drafts stay as history.
  const draft=(await db.query<Row>(`SELECT * FROM settings_revision WHERE setting_key=$1 AND created_by=$2 AND state IN ('Draft','Validated') AND reason LIKE $3
   AND created_at=(SELECT max(created_at) FROM settings_revision WHERE created_by=$2 AND setting_key=ANY($4) AND reason LIKE $3) ORDER BY version DESC LIMIT 1`,[key,user.id,REASON_PREFIX+'%',KEYS])).rows[0];
  out[key]={activeRevision:c.active?{id:c.active.id,version:c.active.version,since:c.active.created_at}:null,usingDefaults:!c.active,paths:pathsOf(key,c.value),enabled:c.value.enabled??null,
   pending:draft?{id:draft.id,version:draft.version,paths:pathsOf(key,draft.value),test:await testState(db,draft)}:null};
 }
 const history=(await db.query<{id:string;setting_key:string;version:number;state:string;created_at:Date;reason:string;actor:string}>(`SELECT r.id,r.setting_key,r.version,r.state,r.created_at,r.reason,u.display_name actor FROM settings_revision r JOIN app_user u ON u.id=r.created_by
  WHERE r.setting_key=ANY($1) AND r.state IN ('Active','Archived') ORDER BY r.created_at DESC LIMIT 20`,[KEYS])).rows;
 return {keys:out,history:history.map(h=>({...h,pathChange:h.reason.startsWith(REASON_PREFIX)}))};
}

/** Creates path-only draft revisions and starts their tests (worker job for HIS folders, folder check for result PDFs). */
export async function proposeHisPaths(db:Queryable,user:Principal,raw:unknown,resultFolderValid:(path:string)=>Promise<boolean>){
 requirePermission(user,'integration.configure',{},'write');
 const input=(raw??{}) as {paths?:Partial<Record<HisPathName,unknown>>;reason?:unknown};
 const reason=String(input.reason??'').trim();if(!reason||reason.length>200)throw Error('REASON_REQUIRED');
 const wanted=input.paths??{},created:{key:PathKey;id:string;version:number;jobId?:string}[]=[];
 for(const key of KEYS){
  const c=await current(db,key),next={...c.value};let changed=false;
  for(const [field,name] of Object.entries(HIS_PATH_FIELDS[key])){const v=wanted[name as HisPathName];if(v===undefined)continue;const s=String(v).trim();if(s!==String(c.value[field]??'')){next[field]=s;changed=true;}}
  if(!changed)continue;
  const value=SETTINGS[key].schema.parse(next) as Record<string,unknown>;
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`settings:${key}`]);
  const row=(await db.query<{id:string;version:number}>(`INSERT INTO settings_revision(setting_key,version,category,risk,value,state,created_by,reason,previous_revision_id)
   VALUES($1,(SELECT COALESCE(max(version),0)+1 FROM settings_revision WHERE setting_key=$1),$2,$3,$4,'Draft',$5,$6,$7) RETURNING id,version`,[key,SETTINGS[key].category,SETTINGS[key].risk,JSON.stringify(value),user.id,REASON_PREFIX+reason,c.active?.id??null])).rows[0];
  await appendAudit(db,{actorId:user.id,action:'HIS_PATH_CHANGE_PROPOSED',resourceType:'SETTING',resourceId:row.id,details:{version:row.version,outcome:'DRAFT'}});
  if(key==='result_management'){await validateSetting(db,user,row.id,async()=>resultFolderValid(String(value.pdfSourcePath)));created.push({key,...row});}
  else{const t=await requestHisTest(db,user,row.id);created.push({key,...row,jobId:t.jobId});}
 }
 if(!created.length)throw Error('HIS_PATH_UNCHANGED');
 return {revisions:created};
}

/** Applies this administrator's tested path-only drafts in one transaction; the worker picks them up on its next job. */
export async function applyHisPaths(db:Queryable,user:Principal,raw:unknown){
 requirePermission(user,'integration.configure',{},'write');
 const ids=((raw as {ids?:unknown})?.ids??[]) as unknown[];
 if(!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=='string'||!/^[0-9a-f-]{36}$/.test(id)))throw Error('REVISION_REQUIRED');
 const applied:{key:string;version:number}[]=[];
 for(const id of ids as string[]){
  const row=(await db.query<Row>('SELECT * FROM settings_revision WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!row||!(row.setting_key in HIS_PATH_FIELDS)||row.created_by!==user.id||!['Draft','Validated'].includes(row.state)||!row.reason.startsWith(REASON_PREFIX))throw Error('HIS_PATH_DRAFT_REQUIRED');
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`settings:${row.setting_key}`]);
  const c=await current(db,row.setting_key);
  if((c.active?.id??null)!==row.previous_revision_id)throw Error('HIS_CONFIGURATION_CHANGED');
  if(withoutPaths(row.setting_key,row.value)!==withoutPaths(row.setting_key,SETTINGS[row.setting_key].schema.parse(c.value) as Record<string,unknown>))throw Error('HIS_PATH_ONLY_CHANGE_REQUIRED');
  if(row.state==='Draft'){
   const t=await testState(db,row);
   if(t.state!=='PASSED')throw Error(t.state==='RUNNING'?'HIS_PATH_TEST_RUNNING':'HIS_PATH_TEST_NOT_PASSED');
   await validateSetting(db,user,row.id,async()=>true);
  }
  await db.query("UPDATE settings_revision SET state='Archived' WHERE setting_key=$1 AND state='Active'",[row.setting_key]);
  await db.query('INSERT INTO setting_active(setting_key,revision_id) VALUES($1,$2) ON CONFLICT(setting_key) DO UPDATE SET revision_id=excluded.revision_id',[row.setting_key,row.id]);
  await db.query("UPDATE settings_revision SET state='Active' WHERE id=$1",[row.id]);
  if(row.setting_key==='his_inbound')await cancelObsoleteInboundScans(db,user.id);
  await appendAudit(db,{actorId:user.id,action:'HIS_PATH_CHANGE_APPLIED',resourceType:'SETTING',resourceId:row.id,details:{version:row.version,outcome:'ACTIVE'}});
  applied.push({key:row.setting_key,version:row.version});
 }
 return {applied,active:await readActiveSettings(db).then(a=>Object.fromEntries(KEYS.map(k=>[k,a[k]?pathsOf(k,a[k] as Record<string,unknown>):null])))};
}
