// The development environment and the rules that keep it away from Staging, Production and the HIS/NAS paths.
// Pure functions (tests/deploy/dev-isolation.node.mjs). `npm run dev*` refuses to start a service whose configuration breaks any rule here.
//   web 127.0.0.1:3100 · renderer 127.0.0.1:3101 · PostgreSQL 127.0.0.1:55452 (database nipt_synthetic_dev) · everything under <repo>/.local/dev
// Staging uses 3010/3011/8443/55442 and Production 3000/3001/443/55432: none of them can be a development port.
import path from 'node:path';
import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {repoRoot} from './lib.mjs';

export const DEV_PORTS={web:3100,renderer:3101,postgres:55452};
export const DEV_HOME=path.join(repoRoot,'.local','dev');
export const DEV_DATA=path.join(DEV_HOME,'data');
export const DEV_DATABASE='nipt_synthetic_dev';
const LOOPBACK=new Set(['127.0.0.1','localhost','::1','[::1]']);
// ports the hospital server uses for Production / Staging / their TLS front ends and the default PostgreSQL ports
const KNOWN_PROTECTED_PORTS=[80,443,3000,3001,3010,3011,5432,5433,8443,55432,55442];
const KNOWN_PROTECTED_ROOTS=['C:\\NIPT-CBH\\production','C:\\NIPT-CBH\\staging'];
const HIS_VARIABLE=/^(NIPT_HIS_|HIS_(INBOUND|OUTBOUND|ROOT|SHARE)|PET_(ROOT|FOLDER)|RES_(ROOT|FOLDER)|NIPT_OPERATIONAL_)/i;

const lower=p=>path.win32.resolve(String(p)).replace(/[\\/]+$/,'').toLowerCase();
const within=(root,p)=>{const r=lower(root),c=lower(p);return c===r||c.startsWith(r+'\\');};

/** Ports and roots of the installed environments, read (never written) from the deployment definitions when this machine has them. */
export function protectedTargets(environmentsDir=process.env.NIPT_DEPLOY_ENV_DIR??'C:\\NIPT-CBH\\deploy\\environments'){
 const ports=new Set(KNOWN_PROTECTED_PORTS),roots=new Set(KNOWN_PROTECTED_ROOTS);
 try{
  if(existsSync(environmentsDir))for(const f of readdirSync(environmentsDir).filter(n=>/^(staging|production)\.json$/.test(n))){
   const e=JSON.parse(readFileSync(path.join(environmentsDir,f),'utf8').replace(/^\uFEFF/,''));
   for(const p of Object.values(e.ports??{}))if(Number.isInteger(p))ports.add(p);
   if(typeof e.root==='string')roots.add(e.root);
  }
 }catch{/* the built-in list still applies */}
 return {ports,roots:[...roots]};
}

export function devEnvironment({home=DEV_HOME,ports=DEV_PORTS}={}){
 const data=path.join(home,'data'),keys=path.join(data,'keys'),secrets=path.join(data,'secrets');
 return {
  NIPT_MODE:'synthetic',
  NIPT_DEV:'1',
  NODE_ENV:'development',
  NEXT_TELEMETRY_DISABLED:'1',
  DATABASE_URL:`postgresql://nipt_dev@127.0.0.1:${ports.postgres}/${DEV_DATABASE}`,
  APP_ORIGIN:`http://127.0.0.1:${ports.web}`,
  RENDERER_URL:`http://127.0.0.1:${ports.renderer}`,
  RENDERER_PORT:String(ports.renderer),
  FILE_STORE_ROOT:path.join(data,'files'),
  SIMULATOR_ROOT:path.join(data,'simulator'),
  RENDERER_TOKEN_FILE:path.join(keys,'renderer-token'),
  INTEGRATION_PUBLIC_KEY_FILE:path.join(keys,'integration-public.pem'),
  INTEGRATION_PRIVATE_KEY_FILE:path.join(keys,'integration-private.pem'),
  IDENTITY_ENCRYPTION_KEY_FILE:path.join(keys,'identity.key'),
  IDENTITY_LOOKUP_KEY_FILE:path.join(keys,'lookup.key'),
  BACKUP_KEY_FILE:path.join(keys,'backup.key'),
  SYNTHETIC_SEED_PASSWORD_FILE:path.join(secrets,'seed-password'),
  WEB_DB_PASSWORD_FILE:path.join(secrets,'web-password'),
  WORKER_DB_PASSWORD_FILE:path.join(secrets,'worker-password')
 };
}

/**
 * Every rule a development configuration must satisfy. Returns the violations (empty = isolated). Never throws, so a report can list them all.
 * `env` is the COMPLETE environment the service would see (inherited variables included), because an inherited NIPT_ENVIRONMENT or HIS variable counts.
 */
export function isolationViolations(env,{home=DEV_HOME,targets=protectedTargets()}={}){
 const v=[];const add=(code,detail)=>v.push({code,detail});
 if(env.NIPT_MODE!=='synthetic')add('DEV_SYNTHETIC_MODE_REQUIRED',`NIPT_MODE=${env.NIPT_MODE??'(unset)'}`);
 if(env.NIPT_ENVIRONMENT)add('DEV_MUST_NOT_RUN_AS_INSTALLED_ENVIRONMENT',`NIPT_ENVIRONMENT=${env.NIPT_ENVIRONMENT}`);
 for(const k of Object.keys(env))if(HIS_VARIABLE.test(k)&&env[k])add('DEV_HIS_OR_OPERATIONAL_VARIABLE_FORBIDDEN',k);
 const hostPort=(name,raw)=>{
  let u;try{u=new URL(raw);}catch{add('DEV_URL_INVALID',name);return null;}
  if(!LOOPBACK.has(u.hostname))add('DEV_HOST_MUST_BE_LOOPBACK',`${name} → ${u.hostname}`);
  const port=Number(u.port||(u.protocol==='https:'?443:u.protocol==='http:'?80:5432));
  if(targets.ports.has(port))add('DEV_PORT_BELONGS_TO_STAGING_OR_PRODUCTION',`${name} → ${port}`);
  return u;
 };
 const db=hostPort('DATABASE_URL',env.DATABASE_URL??'');
 if(db){
  if(!/^postgres(ql)?:$/.test(db.protocol))add('DEV_DATABASE_URL_PROTOCOL',db.protocol);
  const name=decodeURIComponent(db.pathname.slice(1));
  if(!/^nipt_synthetic_dev[a-z0-9_]*$/.test(name))add('DEV_DATABASE_NAME_MUST_BE_RESERVED',`database "${name}" is not nipt_synthetic_dev*`);
  if(db.search||db.hash)add('DEV_DATABASE_URL_OPTIONS_FORBIDDEN',db.search);
 }
 hostPort('APP_ORIGIN',env.APP_ORIGIN??'');hostPort('RENDERER_URL',env.RENDERER_URL??'');
 for(const k of ['FILE_STORE_ROOT','SIMULATOR_ROOT','RENDERER_TOKEN_FILE','INTEGRATION_PUBLIC_KEY_FILE','INTEGRATION_PRIVATE_KEY_FILE','IDENTITY_ENCRYPTION_KEY_FILE','IDENTITY_LOOKUP_KEY_FILE','BACKUP_KEY_FILE','SYNTHETIC_SEED_PASSWORD_FILE','WEB_DB_PASSWORD_FILE','WORKER_DB_PASSWORD_FILE']){
  const p=env[k];
  if(!p){add('DEV_PATH_REQUIRED',k);continue;}
  if(/^(\\\\|\/\/)/.test(p)||!path.win32.isAbsolute(p)&&!path.isAbsolute(p)){add('DEV_PATH_MUST_BE_LOCAL_ABSOLUTE',`${k}=${p}`);continue;}
  if(!within(home,p))add('DEV_PATH_OUTSIDE_DEV_HOME',`${k}=${p}`);
  for(const r of targets.roots)if(within(r,p))add('DEV_PATH_INSIDE_PROTECTED_ROOT',`${k}=${p}`);
 }
 return v;
}
export function assertDevIsolation(env,options){
 const v=isolationViolations(env,options);
 if(v.length)throw Error('DEV_ISOLATION_VIOLATION: '+v.map(x=>`${x.code} (${x.detail})`).join('; '));
}

/** The environment a development child process gets: the inherited one minus anything that could point elsewhere, plus the development settings. */
export function childEnvironment(extra={}){
 const base={...process.env};
 for(const k of Object.keys(base))if(/^(DATABASE_URL|MIGRATION_DATABASE_URL|NIPT_|APP_ORIGIN|RENDERER_|FILE_STORE_|SIMULATOR_|INTEGRATION_|IDENTITY_|BACKUP_|SYNTHETIC_|WEB_DB_|WORKER_DB_|PG(HOST|PORT|USER|PASSWORD|DATABASE|SERVICE))/i.test(k))delete base[k];
 // the toolchain locations survive (they say where programs are, not where data is)
 for(const k of ['NIPT_PG_HOME','NIPT_PWSH_HOME'])if(process.env[k])base[k]=process.env[k];
 const env={...base,...devEnvironment(),...extra};
 assertDevIsolation(env);
 return env;
}
