// Staging / Production environment boundary. Node built-ins only: it is preloaded into every installed service through
// tools/runtime-env.mjs and imported by the share/archive code, so it must not depend on application packages.
// Absent NIPT_ENVIRONMENT = an installation made before the dual-environment layout: nothing here applies (unchanged behaviour).
// Staging fails closed: no remote (UNC) path, nothing outside its own root, nothing inside a protected (Production) root,
// a loopback database on its own port, enforced HIS share policy, and an archive only on a loopback simulator share.
import {readFileSync} from 'node:fs';
import path from 'node:path';

export const ENVIRONMENTS=['staging','production'];
export const STAMP_FILE='environment.json';
export const STAMP_FORMAT='NIPT_ENVIRONMENT_STAMP_V1';
const LOOPBACK=new Set(['127.0.0.1','localhost','::1','[::1]']);

const fail=code=>{throw Error(code);};
const canonical=p=>{const r=path.win32.resolve(p).replace(/[\\/]+$/,'');return r.toLowerCase();};
const isUnc=p=>/^(\\\\|\/\/)/.test(String(p));
const uncHost=p=>String(p).replace(/^(\\\\|\/\/)/,'').split(/[\\/]/)[0].toLowerCase();
/** True when p is root itself or below it (case-insensitive, Windows path rules, no prefix confusion such as staging vs staging-old). */
export function within(root,p){
 const r=canonical(root),c=canonical(p);
 return c===r||c.startsWith(r+'\\');
}

/** The boundary this process runs under, or null for a legacy installation. Throws on a half-configured boundary. */
export function boundaryFromEnv(env=process.env){
 const name=env.NIPT_ENVIRONMENT;
 if(name===undefined||name==='')return null;
 if(!ENVIRONMENTS.includes(name))fail('ENVIRONMENT_INVALID');
 const root=env.NIPT_ENVIRONMENT_ROOT;
 if(!root||!path.win32.isAbsolute(root)||isUnc(root))fail('ENVIRONMENT_ROOT_REQUIRED');
 const protectedRoots=String(env.NIPT_PROTECTED_ROOTS??'').split(';').map(s=>s.trim()).filter(Boolean);
 if(!protectedRoots.length)fail('ENVIRONMENT_PROTECTED_ROOTS_REQUIRED');
 for(const p of protectedRoots){
  if(!path.win32.isAbsolute(p))fail('ENVIRONMENT_PROTECTED_ROOT_INVALID');
  // two environments nested in each other cannot be told apart by path
  if(!isUnc(p)&&(within(p,root)||within(root,p)))fail('ENVIRONMENT_ROOTS_OVERLAP');
 }
 const port=Number(env.NIPT_EXPECTED_PG_PORT);
 if(!Number.isInteger(port)||port<1||port>65535)fail('ENVIRONMENT_PG_PORT_REQUIRED');
 return {name,root:path.win32.resolve(root),protectedRoots,port};
}

/** A local or share path an integration wants to read or write. */
export function assertPathAllowed(p,env=process.env){
 const b=boundaryFromEnv(env);if(!b)return;
 for(const root of b.protectedRoots){
  if(isUnc(root)?isUnc(p)&&within(root,p):!isUnc(p)&&within(root,p))fail('ENVIRONMENT_PROTECTED_PATH_PROHIBITED');
 }
 if(b.name!=='staging')return;
 if(isUnc(p))fail('ENVIRONMENT_STAGING_REMOTE_PATH_PROHIBITED');
 if(!within(b.root,p))fail('ENVIRONMENT_STAGING_PATH_OUTSIDE_ROOT');
}

/** The NAS archive root (always UNC on Windows). Staging may only publish to a share on this machine (the archive simulator). */
export function assertArchiveRootAllowed(root,env=process.env){
 const b=boundaryFromEnv(env);if(!b)return;
 if(b.name==='staging'&&!(isUnc(root)&&LOOPBACK.has(uncHost(root))))fail('ENVIRONMENT_STAGING_ARCHIVE_NOT_LOOPBACK');
 assertPathAllowed(root,{...env,NIPT_ENVIRONMENT:'production'}); // protected-root check only; the staging local-root rule does not apply to a UNC simulator share
}

export function readStamp(root){
 let s;try{s=JSON.parse(readFileSync(path.join(root,STAMP_FILE),'utf8'));}catch{fail('ENVIRONMENT_STAMP_MISSING');}
 if(s?.format!==STAMP_FORMAT||!ENVIRONMENTS.includes(s.environment))fail('ENVIRONMENT_STAMP_INVALID');
 return s;
}

/** Process start: every service checks the whole configuration it was given before it opens anything. */
export function assertProcessBoundary(env=process.env){
 const b=boundaryFromEnv(env);if(!b)return null;
 if(readStamp(b.root).environment!==b.name)fail('ENVIRONMENT_STAMP_MISMATCH');
 if(env.DATABASE_URL){
  let u;try{u=new URL(env.DATABASE_URL);}catch{fail('ENVIRONMENT_DATABASE_URL_INVALID');}
  if(!LOOPBACK.has(u.hostname.toLowerCase()))fail('ENVIRONMENT_DATABASE_NOT_LOOPBACK');
  if(Number(u.port||5432)!==b.port)fail('ENVIRONMENT_DATABASE_PORT_MISMATCH');
 }
 for(const k of ['FILE_STORE_ROOT','SIMULATOR_ROOT','NIPT_HIS_SHARE_POLICY_FILE','NIPT_BACKUP_POLICY_FILE','NIPT_NATIVE_EXCEL_SPOOL']){
  const v=env[k];if(!v)continue;
  if(isUnc(v)||!within(b.root,v))fail('ENVIRONMENT_'+k+'_OUTSIDE_ROOT');
 }
 if(b.name==='staging'){
  if(env.NIPT_HIS_SHARE_POLICY_ENFORCE!=='1')fail('ENVIRONMENT_STAGING_SHARE_POLICY_NOT_ENFORCED');
  if(!env.NIPT_HIS_SHARE_POLICY_FILE)fail('ENVIRONMENT_STAGING_SHARE_POLICY_REQUIRED');
  let policy;try{policy=JSON.parse(readFileSync(env.NIPT_HIS_SHARE_POLICY_FILE,'utf8'));}catch{fail('ENVIRONMENT_STAGING_SHARE_POLICY_INVALID');}
  for(const g of policy?.grants??[])assertPathAllowed(g.root,env);
 }
 if(env.FINAL_REPORT_ARCHIVE_ENABLED==='true')assertArchiveRootAllowed(String(env.FINAL_REPORT_ARCHIVE_ROOT??''),env);
 return b;
}
