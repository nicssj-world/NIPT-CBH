// Windows offline installer: shared helpers. Node built-ins only, so the installer runs from the package's own node.exe
// before any application dependency exists. Everything here is deterministic and unit-tested (tests/unit/win-installer-lib.test.ts).
import {createHash,verify} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,readdir,lstat,writeFile,rename,mkdir,statfs} from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

export const PRODUCT='NIPT-CBH';
export const INSTALLER_FORMAT='NIPT_WINDOWS_OFFLINE_PACKAGE_V1';
export const MIN_FREE_BYTES=8*1024**3;
export const DEFAULT_PORTS={postgres:5432,web:3000,https:443,renderer:3001};
export const DATABASE_NAME=/^nipt_(operational|synthetic)_[a-z0-9_]{1,40}$/;
export const INSTANCE_NAME=/^[a-z0-9][a-z0-9-]{2,40}$/;

/** Semantic-version ordering, strict: x.y.z with an optional -label that sorts before the plain release. */
export function parseVersion(text){
 const m=/^(\d{1,4})\.(\d{1,4})\.(\d{1,4})(?:-([a-z0-9.]{1,24}))?$/.exec(String(text));
 if(!m)throw Error('VERSION_INVALID');
 return {major:+m[1],minor:+m[2],patch:+m[3],label:m[4]??null};
}
export function compareVersions(a,b){
 const x=parseVersion(a),y=parseVersion(b);
 for(const k of ['major','minor','patch'])if(x[k]!==y[k])return x[k]<y[k]?-1:1;
 if(x.label===y.label)return 0;
 if(x.label===null)return 1;
 if(y.label===null)return -1;
 return x.label<y.label?-1:1;
}

export const sha256Bytes=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function sha256File(file){const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');}

/** Every path the installer owns, derived from one root. */
export function layout(root){
 const r=path.resolve(root),j=(...p)=>path.join(r,...p);
 return {
  root:r,releases:j('releases'),runtime:j('runtime'),node:j('runtime','node','node.exe'),pg:j('runtime','pg'),pgBin:j('runtime','pg','bin'),
  browsers:j('runtime','browsers'),data:j('data'),pgdata:j('data','pgdata'),files:j('data','files'),inbound:j('data','integration','inbound'),
  outbound:j('data','integration','outbound'),master:j('data','master'),secrets:j('secrets'),config:j('config'),configFile:j('config','nipt.json'),
  tls:j('config','tls'),logs:j('logs'),run:j('run'),stop:j('run','stop.request'),supervisorLock:j('run','supervisor.lock'),state:j('run','state.json'),
  excelSpool:j('data','excel-spool'),backups:j('backups'),restores:j('restores'),installState:j('install-state.json'),credentials:j('credentials.txt')
 };
}

/** Validate the installer configuration. Returns the normalized object or throws a stable code. */
export function validateConfig(c){
 const need=(ok,code)=>{if(!ok)throw Error(code);};
 need(c&&typeof c==='object','CONFIG_INVALID');
 need(INSTANCE_NAME.test(c.instance??''),'CONFIG_INSTANCE_INVALID');
 need(['operational','synthetic'].includes(c.mode),'CONFIG_MODE_INVALID');
 need(DATABASE_NAME.test(c.database??'')&&c.database.startsWith('nipt_'+c.mode+'_'),'CONFIG_DATABASE_INVALID');
 const p=c.ports??{};
 for(const k of ['postgres','web','https','renderer'])need(Number.isInteger(p[k])&&p[k]>=1&&p[k]<=65535,'CONFIG_PORT_INVALID');
 need(new Set([p.postgres,p.web,p.https,p.renderer]).size===4,'CONFIG_PORTS_DUPLICATE');
 need(c.testEnvironmentOnly===true,'CONFIG_TEST_ENVIRONMENT_ONLY_REQUIRED');
 need(['user','system'].includes(c.taskMode),'CONFIG_TASK_MODE_INVALID');
 // The HTTPS front listens on loopback unless IT explicitly publishes it on a LAN address (never PostgreSQL, web or renderer).
 need(c.httpsHost===undefined||c.httpsHost==='0.0.0.0'||/^(?:\d{1,3}\.){3}\d{1,3}$/.test(c.httpsHost),'CONFIG_HTTPS_HOST_INVALID');
 need(c.excelMode===undefined||['direct','bridge'].includes(c.excelMode),'CONFIG_EXCEL_MODE_INVALID');
 // Excel automation is unsupported in session 0, so a SYSTEM task can only reach Excel through the bridge running in a user session.
 need(!(c.taskMode==='system'&&(c.excelMode??'bridge')==='direct'),'CONFIG_SYSTEM_TASK_REQUIRES_EXCEL_BRIDGE');
 need(typeof c.origin==='string'&&/^https:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(c.origin)||/^https:\/\/[a-z0-9.-]+(:\d+)?$/.test(c.origin??''),'CONFIG_ORIGIN_INVALID');
 return c;
}

export function assertSafeRoot(root,packageDir){
 const r=path.resolve(root);
 need(path.parse(r).root!==r,'INSTALL_ROOT_IS_DRIVE_ROOT');
 need(r.length>=8,'INSTALL_ROOT_TOO_SHORT');
 // initdb/postgres.exe start child processes through ANSI Windows APIs: a root that the system code page cannot represent (e.g. Thai on a
 // Western code page) makes them look for a path full of '?'. Found by the rehearsal. Data folders handled by Node (photos, backups, shares) may be Thai.
 need(/^[ -~]+$/.test(r),'INSTALL_ROOT_MUST_BE_ASCII');
 const rel=path.relative(path.resolve(packageDir),r);
 need(rel.startsWith('..')||path.isAbsolute(rel),'INSTALL_ROOT_INSIDE_PACKAGE');
 const rel2=path.relative(r,path.resolve(packageDir));
 need(rel2.startsWith('..')||path.isAbsolute(rel2),'PACKAGE_INSIDE_INSTALL_ROOT');
 return r;
 function need(ok,code){if(!ok)throw Error(code);}
}

export function portFree(port,host='127.0.0.1'){
 return new Promise(resolve=>{const s=net.createServer();s.once('error',()=>resolve(false));s.listen(port,host,()=>s.close(()=>resolve(true)));});
}

export async function freeBytes(dir){const s=await statfs(dir);return Number(s.bavail)*Number(s.bsize);}

/** Atomic JSON write (temp file + rename) so a crash never leaves a half-written state file. */
export async function writeJson(file,value){
 await mkdir(path.dirname(file),{recursive:true});
 const tmp=file+'.'+process.pid+'.tmp';
 await writeFile(tmp,JSON.stringify(value,null,2),{mode:0o600});
 await rename(tmp,file);
}
export async function readJson(file,fallback=undefined){
 try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT'&&fallback!==undefined)return fallback;throw e;}
}

/** Hash every file under dir (relative POSIX names), skipping the manifest and its signature. Symlinks are refused. */
export async function directoryHashes(dir,skip=['manifest.json','manifest.sig']){
 const out={};
 async function walk(rel=''){
  for(const e of await readdir(path.join(dir,rel),{withFileTypes:true})){
   const name=rel?rel+'/'+e.name:e.name;
   if(skip.includes(name))continue;
   if(e.isSymbolicLink())throw Error('PACKAGE_SYMLINK');
   if(e.isDirectory())await walk(name);else if(e.isFile())out[name]=await sha256File(path.join(dir,name));
  }
 }
 await walk();
 return Object.fromEntries(Object.entries(out).sort(([a],[b])=>a<b?-1:a>b?1:0));
}

const safeRelative=n=>!path.isAbsolute(n)&&!n.includes('\\')&&n.split('/').every(s=>s&&s!=='.'&&s!=='..');

/** Verify a package folder against its Ed25519-signed manifest using a public key obtained independently of the package. */
export async function verifyPackage(dir,publicKeyFile){
 if((await lstat(dir)).isSymbolicLink())throw Error('PACKAGE_SYMLINK');
 const raw=await readFile(path.join(dir,'manifest.json'));
 if(raw.length>8*1024*1024)throw Error('MANIFEST_TOO_LARGE');
 if(!verify(null,raw,await readFile(publicKeyFile),await readFile(path.join(dir,'manifest.sig'))))throw Error('SIGNATURE_INVALID');
 const m=JSON.parse(raw);
 if(m.format!==INSTALLER_FORMAT||m.testEnvironmentOnly!==true||!m.files||typeof m.files!=='object')throw Error('PACKAGE_MANIFEST_INVALID');
 parseVersion(m.version);
 if(!/^[a-f0-9]{40}$/.test(m.revision??'')||!/^[a-f0-9]{64}$/.test(m.migrationsSha256??''))throw Error('PACKAGE_PROVENANCE_REQUIRED');
 for(const n of Object.keys(m.files))if(!safeRelative(n))throw Error('PACKAGE_UNSAFE_PATH');
 const actual=await directoryHashes(dir);
 const a=Object.keys(actual),b=Object.keys(m.files).sort();
 if(a.length!==b.length||a.some((n,i)=>n!==b[i]))throw Error('PACKAGE_FILESET_MISMATCH');
 for(const n of a)if(actual[n]!==m.files[n])throw Error('PACKAGE_CHECKSUM_MISMATCH');
 return m;
}

/** A release is application-compatible with a database when every ledger row it knows has the same checksum and the database holds no migration it lacks. */
export function schemaCompatibility({ledger,releaseMigrations}){
 const known=new Map(Object.entries(releaseMigrations));
 const unknown=[],changed=[];
 for(const row of ledger){
  if(!known.has(row.name))unknown.push(row.name);
  else if(known.get(row.name)!==row.checksum)changed.push(row.name);
 }
 const applied=new Set(ledger.map(r=>r.name));
 const pending=[...known.keys()].filter(n=>!applied.has(n)).sort();
 return {compatibleWithDatabase:unknown.length===0&&changed.length===0,unknown,changed,pending};
}

/** The database level a rollback target can run on: it must not know fewer migrations than are applied. */
export function canRollbackApplicationOnly({ledger,targetMigrations}){
 const r=schemaCompatibility({ledger,releaseMigrations:targetMigrations});
 return {ok:r.compatibleWithDatabase,reason:r.unknown.length?'DATABASE_NEWER_THAN_TARGET':r.changed.length?'MIGRATION_CHECKSUM_DIFFERS':null,...r};
}

/** Service verdict from the operator health report (tools/p8/health.ts, operational format) plus the installer's own probes.
 * A missing or false probe is a failure, never an assumption. `technicalReady` additionally needs a verified, recent backup and is reported separately. */
export function healthVerdict(report,extra){
 const checks={
  supervisor:extra?.supervisor===true,https:extra?.https===true,
  database:report?.databaseReachable===true,web:report?.webReachable===true,renderer:report?.rendererReachable===true,
  fileStorage:report?.fileStorageAccessible===true,worker:report?.workerAlive===true&&report?.workerError===false,
  excelBridge:extra?.excelBridge!==false,
  migrations:report?.migrationsMatch===true,audit:report?.auditValid===true,roles:report?.rolesRestricted===true,notQuarantined:report?.quarantined===false
 };
 const failed=Object.entries(checks).filter(([,v])=>!v).map(([k])=>k);
 return {ok:failed.length===0,failed,technicalReady:report?.technicalReady===true,backupStatus:report?.backupStatus??'UNKNOWN'};
}

/** Backoff schedule for the supervisor: 1,2,4,8,16,30,30,... seconds; resets after a stable run. */
export function backoffMs(restarts){return Math.min(30000,1000*2**Math.max(0,restarts));}

/** Parse `psql -A -t` output of "name|checksum" rows. Windows psql ends lines with CRLF; a trailing CR must never change a checksum. */
export function parseLedgerOutput(text){
 return String(text).split(String.fromCharCode(10)).map(l=>l.trim()).filter(Boolean).map(l=>{const [name,checksum]=l.split('|');return {name,checksum};});
}
