// Decisions of the Windows Staging/Production deployment (deploy\windows\*.ps1). Node built-ins only and pure where possible, so every
// gate is unit-tested (tests/deploy/deploy-gates.node.mjs) and the PowerShell scripts only orchestrate.
//   node deploy-gates.mjs <command> <input.json>   → one JSON line on stdout; exit 1 when the result has ok:false
// Commands: environments, release-id, package-facts, production-gate.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const ENVIRONMENT_FORMAT='NIPT_DEPLOY_ENVIRONMENT_V1';
export const VERIFIED_FORMAT='NIPT_STAGING_VERIFIED_V1';
const fail=code=>{throw Error(code);};
const lower=p=>path.win32.resolve(p).replace(/[\\/]+$/,'').toLowerCase();
const within=(root,p)=>{const r=lower(root),c=lower(p);return c===r||c.startsWith(r+'\\');};

/** One environment definition (deploy\environments\<name>.json): no credentials, only names, paths and ports. */
const PLACEHOLDER=/^(replace|example|changeme|todo|tbd|xxx)/i;
export function validateEnvironment(e,name,{purpose='staging'}={}){
 const need=(ok,code)=>{if(!ok)fail(code);};
 need(e&&e.format===ENVIRONMENT_FORMAT,'ENVIRONMENT_FORMAT_INVALID');
 need(e.environment===name,'ENVIRONMENT_NAME_MISMATCH');
 need(typeof e.root==='string'&&/^[A-Za-z]:\\[ -~]+$/.test(e.root)&&path.win32.parse(e.root).root!==path.win32.resolve(e.root),'ENVIRONMENT_ROOT_INVALID');
 need(/^[a-z0-9][a-z0-9-]{2,40}$/.test(e.instance??''),'ENVIRONMENT_INSTANCE_INVALID');
 const p=e.ports??{};
 for(const k of ['postgres','web','https','renderer'])need(Number.isInteger(p[k])&&p[k]>=1&&p[k]<=65535,'ENVIRONMENT_PORT_INVALID');
 need(new Set([p.postgres,p.web,p.https,p.renderer]).size===4,'ENVIRONMENT_PORTS_DUPLICATE');
 need(e.profile===(name==='staging'?'test':'production'),'ENVIRONMENT_PROFILE_MISMATCH');
 need(['user','system'].includes(e.taskMode),'ENVIRONMENT_TASK_MODE_INVALID');
 need(['direct','bridge'].includes(e.excelMode),'ENVIRONMENT_EXCEL_MODE_INVALID');
 need(!(e.taskMode==='system'&&e.excelMode==='direct'),'ENVIRONMENT_SYSTEM_TASK_REQUIRES_EXCEL_BRIDGE');
 // a dedicated non-interactive service account cannot drive desktop Excel: the bridge runs in the owner's session instead
 need(!(e.serviceAccount&&e.excelMode==='direct'),'ENVIRONMENT_SERVICE_ACCOUNT_REQUIRES_EXCEL_BRIDGE');
 need(e.serviceAccount===undefined||e.serviceAccount===null||/^[A-Za-z0-9][A-Za-z0-9._-]{2,19}$/.test(e.serviceAccount),'ENVIRONMENT_SERVICE_ACCOUNT_INVALID');
 need(e.lan&&typeof e.lan.enabled==='boolean','ENVIRONMENT_LAN_INVALID');
 need(e.lan.listen===undefined||/^(?:\d{1,3}\.){3}\d{1,3}$/.test(e.lan.listen),'ENVIRONMENT_LAN_LISTEN_INVALID');
 if(name==='production'){
  // the ONE first account (APP_ADMIN, owner decision 2026-11-01) is the owner's real person: never a default, never a placeholder.
  // Only a Production action needs it, so a Staging deployment is not held up while it is still being chosen. A definition that
  // still names a second bootstrap account (the former CLINICAL_APPROVER) is refused, not ignored: that person is added later in
  // user management.
  if(purpose==='production'){
   const b=e.bootstrap??{};
   for(const k of ['adminUser','adminName'])need(typeof b[k]==='string'&&b[k].trim().length>0&&!PLACEHOLDER.test(b[k].trim()),'PRODUCTION_BOOTSTRAP_IDENTITY_REQUIRED');
   need(/^[a-z0-9._-]{3,64}$/.test(b.adminUser),'PRODUCTION_BOOTSTRAP_USERNAME_INVALID');
   for(const k of ['checkerUser','checkerName'])need(b[k]===undefined||b[k]===null||(typeof b[k]==='string'&&!b[k].trim()),'PRODUCTION_SINGLE_ADMIN_BOOTSTRAP_ONLY');
  }
  need(typeof e.releaseBranch==='string'&&/^[A-Za-z0-9._/-]+$/.test(e.releaseBranch),'PRODUCTION_RELEASE_BRANCH_REQUIRED');
  need(Number.isInteger(e.stagingVerifiedMaxAgeDays)&&e.stagingVerifiedMaxAgeDays>=1&&e.stagingVerifiedMaxAgeDays<=90,'PRODUCTION_VERIFIED_AGE_INVALID');
  // the Staging workflow UAT is not configurable; an old definition that tries to switch it off is refused, not ignored
  need(e.requireStagingJourney===undefined||e.requireStagingJourney===true,'PRODUCTION_STAGING_UAT_CANNOT_BE_DISABLED');
 }
 for(const k of ['signingKey','masterWorkbook','ancRequestPdf','ancConsentPdf'])need(typeof e[k]==='string'&&path.win32.isAbsolute(e[k]),'ENVIRONMENT_'+k.toUpperCase()+'_PATH_REQUIRED');
 // build-package derives the public key by replacing the FIRST 'private' in the whole path: it must occur in the file name only
 need(/private/.test(path.win32.basename(e.signingKey))&&!/private/.test(path.win32.dirname(e.signingKey)),'ENVIRONMENT_SIGNING_KEY_NAME_MUST_CONTAIN_PRIVATE');
 return e;
}

/** Both environments together: nothing may be shared (root, instance, port, key, account). */
export function validateEnvironmentPair(staging,production,{purpose='staging'}={}){
 if(!['staging','production'].includes(purpose))fail('ENVIRONMENT_PURPOSE_INVALID');
 validateEnvironment(staging,'staging',{purpose});validateEnvironment(production,'production',{purpose});
 const need=(ok,code)=>{if(!ok)fail(code);};
 need(!within(staging.root,production.root)&&!within(production.root,staging.root),'ENVIRONMENT_ROOTS_OVERLAP');
 need(staging.instance!==production.instance,'ENVIRONMENT_INSTANCE_SHARED');
 const sp=Object.values(staging.ports),pp=Object.values(production.ports);
 need(!sp.some(p=>pp.includes(p)),'ENVIRONMENT_PORT_SHARED');
 need(lower(staging.signingKey)!==lower(production.signingKey),'ENVIRONMENT_SIGNING_KEY_SHARED');
 need(!staging.serviceAccount||!production.serviceAccount||staging.serviceAccount.toLowerCase()!==production.serviceAccount.toLowerCase(),'ENVIRONMENT_SERVICE_ACCOUNT_SHARED');
 need(!within(staging.root,staging.signingKey)&&!within(production.root,production.signingKey)&&!within(staging.root,production.signingKey),'ENVIRONMENT_SIGNING_KEY_INSIDE_RUNTIME_ROOT');
 return {ok:true,staging:{root:staging.root,protectedRoots:[production.root]},production:{root:production.root,protectedRoots:[staging.root]}};
}

/** Package version = deployment release ID: <application version>-d<UTC yyyymmddhhmmss>.<sha7>. Sorts after every earlier deployment of the
 *  same application version under the installer's version order (labels compare as text), and before the next application version. */
export function releaseId(appVersion,commit,at=new Date()){
 if(!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(String(appVersion)))fail('APP_VERSION_INVALID');
 if(!/^[a-f0-9]{40}$/.test(String(commit)))fail('COMMIT_SHA_REQUIRED');
 const t=at.toISOString().replace(/[-:T]/g,'').slice(0,14);
 return `${appVersion}-d${t}.${commit.slice(0,7)}`;
}

/** Digest of everything that becomes the release folder (payload/release/**): equal digests = byte-identical application, migrations and tools. */
export function payloadDigest(manifest){
 const lines=Object.entries(manifest.files??{}).filter(([n])=>n.startsWith('payload/release/')).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([n,h])=>n+':'+h+'\n');
 if(!lines.length)fail('PACKAGE_RELEASE_PAYLOAD_EMPTY');
 return createHash('sha256').update(lines.join('')).digest('hex');
}

const DESTRUCTIVE=[/\bDROP\s+(TABLE|SCHEMA|DATABASE|COLUMN|VIEW|MATERIALIZED\s+VIEW|TYPE|FUNCTION|TRIGGER|INDEX)\b/i,/\bTRUNCATE\b/i,/\bDELETE\s+FROM\b/i,/\bALTER\s+TABLE\b[^;]*\bDROP\b/i,/\bALTER\s+TABLE\b[^;]*\bALTER\s+COLUMN\b[^;]*\bTYPE\b/i];
/** Statements a person must approve before they run on Production. SQL comments are ignored; the check errs on the side of asking. */
export function destructiveStatements(sql){
 const text=String(sql).replace(/--[^\n]*/g,'').replace(/\/\*[\s\S]*?\*\//g,'');
 return text.split(';').map(s=>s.trim()).filter(s=>DESTRUCTIVE.some(re=>re.test(s))).map(s=>s.replace(/\s+/g,' ').slice(0,160));
}

/** Everything that must be true before a Production upgrade or first install starts. Returns every failure, never only the first. */
export function productionGate(i){
 const failures=[];const add=(ok,code,detail)=>{if(!ok)failures.push(detail===undefined?{code}:{code,detail});};
 const v=i.verified;
 add(!!v&&v.format===VERIFIED_FORMAT,'STAGING_VERIFICATION_MISSING');
 if(v&&v.format===VERIFIED_FORMAT){
  add(v.commit===i.commit,'STAGING_VERIFIED_COMMIT_MISMATCH',{verified:v.commit,requested:i.commit});
  add(v.outcome==='SUCCEEDED'&&v.health?.ok===true,'STAGING_DEPLOYMENT_NOT_HEALTHY');
  add(v.schema?.ok===true,'STAGING_SCHEMA_NOT_CURRENT');
  const age=(Date.parse(i.now)-Date.parse(v.verifiedAt))/86400000;
  add(Number.isFinite(age)&&age>=0&&age<=i.maxAgeDays,'STAGING_VERIFICATION_TOO_OLD',{ageDays:Math.round(age*10)/10,maxAgeDays:i.maxAgeDays});
  // the synthetic clinical workflow UAT of this exact commit is mandatory: no configuration value can switch it off (owner decision)
  add(v.journey?.passed===true&&v.journey?.commit===i.commit,'STAGING_WORKFLOW_UAT_NOT_PASSED');
  // Staging's live state is never an input: a release verified earlier stays verified while Staging is stopped (on-demand Staging)
  add(v.payloadDigest===i.payloadDigest,'PRODUCTION_PAYLOAD_DIFFERS_FROM_STAGING_VERIFIED',{verified:v.payloadDigest,production:i.payloadDigest});
  add(v.migrationsSha256===i.release?.migrationsSha256,'PRODUCTION_MIGRATIONS_DIFFER_FROM_STAGING');
 }
 add(i.onReleaseBranch===true,'COMMIT_NOT_ON_RELEASE_BRANCH');
 add(typeof i.approvedBy==='string'&&i.approvedBy.trim().length>=2,'RELEASE_APPROVER_REQUIRED');
 add(typeof i.changeReference==='string'&&i.changeReference.trim().length>=2,'CHANGE_REFERENCE_REQUIRED');
 add(i.confirmation===`DEPLOY PRODUCTION ${String(i.commit).slice(0,7)}`,'PRODUCTION_CONFIRMATION_PHRASE_REQUIRED');
 // schema: Production's own ledger must be compatible, and every migration it is about to run must already have run, with the same checksum, on Staging
 if(i.productionLedger){
  const rel=i.release?.migrations??{},known=new Map(Object.entries(rel));
  const unknown=i.productionLedger.filter(r=>!known.has(r.name)).map(r=>r.name);
  const changed=i.productionLedger.filter(r=>known.has(r.name)&&known.get(r.name)!==r.checksum).map(r=>r.name);
  add(!unknown.length&&!changed.length,'PRODUCTION_SCHEMA_INCOMPATIBLE',{unknown,changed});
  const applied=new Set(i.productionLedger.map(r=>r.name));
  const pending=[...known.keys()].filter(n=>!applied.has(n)).sort();
  const rehearsed=new Map((v?.schema?.ledger??[]).map(r=>[r.name,r.checksum]));
  const notRehearsed=pending.filter(n=>rehearsed.get(n)!==rel[n]);
  add(!notRehearsed.length,'PRODUCTION_MIGRATION_NOT_REHEARSED_ON_STAGING',{notRehearsed});
  const allowed=new Set(i.allowDestructive??[]);
  const destructive=Object.entries(i.pendingSql??{}).filter(([n,sql])=>pending.includes(n)&&destructiveStatements(sql).length).map(([n])=>n);
  const unapproved=destructive.filter(n=>!allowed.has(n));
  add(!unapproved.length,'DESTRUCTIVE_MIGRATION_REQUIRES_EXPLICIT_APPROVAL',{migrations:unapproved});
  return {ok:failures.length===0,failures,pending,destructive};
 }
 return {ok:failures.length===0,failures,pending:Object.keys(i.release?.migrations??{}).sort(),destructive:[],firstInstall:true};
}

/** Facts the scripts need from a built package without parsing a multi-megabyte manifest in Windows PowerShell 5.1. */
export function packageFacts(dir){
 const m=JSON.parse(readFileSync(path.join(dir,'manifest.json'),'utf8'));
 const release=JSON.parse(readFileSync(path.join(dir,'payload','release','release.json'),'utf8'));
 return {version:m.version,revision:m.revision,profile:m.profile,testEnvironmentOnly:m.testEnvironmentOnly,runtimeIncluded:m.runtimeIncluded,fileCount:Object.keys(m.files).length,
  migrationsSha256:m.migrationsSha256,migrationCount:release.migrationCount,migrations:release.migrations,buildId:release.buildId,payloadDigest:payloadDigest(m)};
}

const cli=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(cli){
 const [command,inputFile]=process.argv.slice(2);
 try{
  const input=inputFile?JSON.parse(readFileSync(inputFile,'utf8').replace(/^﻿/,'')):{};
  const out=command==='environments'?validateEnvironmentPair(input.staging,input.production,{purpose:input.purpose??'staging'})
   :command==='release-id'?{ok:true,releaseId:releaseId(input.appVersion,input.commit,input.at?new Date(input.at):new Date())}
   :command==='package-facts'?{ok:true,...packageFacts(input.dir)}
   :command==='production-gate'?productionGate(input)
   :fail('GATE_COMMAND_UNKNOWN');
  process.stdout.write(JSON.stringify(out)+'\n');
  if(out.ok===false)process.exitCode=1;
 }catch(e){process.stdout.write(JSON.stringify({ok:false,error:e.message})+'\n');process.exitCode=1;}
}
