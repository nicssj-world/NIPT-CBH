// Staging / Production environment boundary. Node built-ins only: it is preloaded into every installed service through
// tools/runtime-env.mjs and imported by the share/archive code, so it must not depend on application packages.
// Absent NIPT_ENVIRONMENT = an installation made before the dual-environment layout: nothing here applies (unchanged behaviour).
// Staging fails closed: no remote (UNC) path, nothing outside its own root, nothing inside a protected (Production) root,
// a loopback database on its own port, enforced HIS share policy, and an archive only on a loopback simulator share.
import {readFileSync,realpathSync,existsSync} from 'node:fs';
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
 // native resolution for file access (the stamp); every containment decision uses Windows rules through within()
 return {name,root:path.resolve(root),protectedRoots,port};
}

/** Where a local path really leads: its nearest existing ancestor resolved by the OS (junctions, symbolic links, 8.3 short names;
 *  a mapped network drive comes back as its UNC path), with the not-yet-existing remainder appended. Null when nothing differs. */
function resolvedAlias(p){
 if(isUnc(p)||!path.isAbsolute(p))return null; // a Windows-shaped path on another platform is not a local file system path
 let existing=path.resolve(p);const rest=[];
 while(!existsSync(existing)){const parent=path.dirname(existing);if(parent===existing)return null;rest.unshift(path.basename(existing));existing=parent;}
 let real;try{real=realpathSync.native(existing);}catch{return null;}
 const full=rest.length?path.join(real,...rest):real;
 return lower(full)===lower(path.resolve(p))?null:full;
}
const lower=p=>String(p).replace(/[\\/]+$/,'').replace(/\//g,'\\').toLowerCase();

/** A local or share path an integration wants to read or write: checked as written AND as the OS resolves it, so a junction,
 *  link, short name or mapped drive cannot alias a Production folder or a remote share into an allowed-looking path. */
export function assertPathAllowed(p,env=process.env){
 const b=boundaryFromEnv(env);if(!b)return;
 const rootAlias=b.name==='staging'?resolvedAlias(b.root):null;
 assertLexical(p,b,rootAlias);
 const alias=resolvedAlias(p);
 if(alias)assertLexical(alias,b,rootAlias);
}
/** Inside the environment's own root, as configured or as the OS resolves the root (a root reached through a short name stays valid). */
const insideOwnRoot=(b,p,rootAlias)=>within(b.root,p)||(!!rootAlias&&!isUnc(rootAlias)&&within(rootAlias,p));
function assertLexical(p,b,rootAlias){
 for(const root of b.protectedRoots){
  if(isUnc(root)?isUnc(p)&&within(root,p):!isUnc(p)&&within(root,p))fail('ENVIRONMENT_PROTECTED_PATH_PROHIBITED');
 }
 if(b.name!=='staging')return;
 if(isUnc(p))fail('ENVIRONMENT_STAGING_REMOTE_PATH_PROHIBITED');
 if(!insideOwnRoot(b,p,rootAlias))fail('ENVIRONMENT_STAGING_PATH_OUTSIDE_ROOT');
}

/** The NAS archive root (always UNC on Windows). Staging may only publish to its own archive-simulator share on this machine:
 *  \\localhost\nipt-staging-<name>. Any other loopback share (C$, ADMIN$, a share of the Production root) is refused. */
export function assertArchiveRootAllowed(root,env=process.env){
 const b=boundaryFromEnv(env);if(!b)return;
 if(b.name==='staging'){
  if(!(isUnc(root)&&LOOPBACK.has(uncHost(root))))fail('ENVIRONMENT_STAGING_ARCHIVE_NOT_LOOPBACK');
  const share=String(root).replace(/^(\\\\|\/\/)/,'').split(/[\\/]/)[1]??'';
  if(!/^nipt-staging-[a-z0-9-]{1,40}$/i.test(share))fail('ENVIRONMENT_STAGING_ARCHIVE_SHARE_NOT_SIMULATOR');
 }
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
 // the root itself must not be an alias (junction, link, mapped drive) of a protected root or of a share
 const rootAlias=resolvedAlias(b.root);
 if(rootAlias&&(isUnc(rootAlias)||b.protectedRoots.some(r=>!isUnc(r)&&within(r,rootAlias))))fail('ENVIRONMENT_ROOT_IS_AN_ALIAS');
 if(readStamp(b.root).environment!==b.name)fail('ENVIRONMENT_STAMP_MISMATCH');
 if(env.DATABASE_URL){
  let u;try{u=new URL(env.DATABASE_URL);}catch{fail('ENVIRONMENT_DATABASE_URL_INVALID');}
  if(!LOOPBACK.has(u.hostname.toLowerCase()))fail('ENVIRONMENT_DATABASE_NOT_LOOPBACK');
  if(Number(u.port||5432)!==b.port)fail('ENVIRONMENT_DATABASE_PORT_MISMATCH');
 }
 for(const k of ['FILE_STORE_ROOT','SIMULATOR_ROOT','NIPT_HIS_SHARE_POLICY_FILE','NIPT_BACKUP_POLICY_FILE','NIPT_NATIVE_EXCEL_SPOOL']){
  const v=env[k];if(!v)continue;
  // as written and as the OS resolves it: a junction inside the root that leads elsewhere is outside the root
  for(const candidate of [v,resolvedAlias(v)].filter(Boolean)){
   if(isUnc(candidate)||!insideOwnRoot(b,candidate,rootAlias))fail('ENVIRONMENT_'+k+'_OUTSIDE_ROOT');
   if(b.protectedRoots.some(r=>!isUnc(r)&&within(r,candidate)))fail('ENVIRONMENT_'+k+'_IN_PROTECTED_ROOT');
  }
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
