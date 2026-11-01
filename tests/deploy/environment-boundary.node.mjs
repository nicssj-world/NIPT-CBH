import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {within,boundaryFromEnv,assertPathAllowed,assertArchiveRootAllowed,assertProcessBoundary,STAMP_FORMAT} from '../../tools/environment-boundary.mjs';
import {validateConfig,environmentVariables,environmentStampProblem,ENVIRONMENT_STAMP_FORMAT} from '../../tools/win-installer/lib.mjs';

// Windows-shaped paths throughout: the boundary uses Windows path rules on every platform, so CI on Linux checks the same decisions.
const STAGING='C:\\NIPT-CBH\\staging',PRODUCTION='C:\\NIPT-CBH\\production';
const staging={NIPT_ENVIRONMENT:'staging',NIPT_ENVIRONMENT_ROOT:STAGING,NIPT_PROTECTED_ROOTS:PRODUCTION,NIPT_EXPECTED_PG_PORT:'55442',NIPT_HIS_SHARE_POLICY_ENFORCE:'1'};
const production={NIPT_ENVIRONMENT:'production',NIPT_ENVIRONMENT_ROOT:PRODUCTION,NIPT_PROTECTED_ROOTS:STAGING,NIPT_EXPECTED_PG_PORT:'55432'};
const code=re=>({message:re});

test('legacy installation without NIPT_ENVIRONMENT keeps its behaviour',()=>{
 assert.equal(boundaryFromEnv({}),null);
 assert.doesNotThrow(()=>assertPathAllowed('\\\\his-server\\pet',{}));
 assert.doesNotThrow(()=>assertArchiveRootAllowed('\\\\nas\\archive',{}));
 assert.equal(assertProcessBoundary({DATABASE_URL:'postgresql://u:p@db.example:5432/x'}),null);
});

test('path containment is case-insensitive and never confused by a shared prefix',()=>{
 assert.equal(within(STAGING,'c:\\nipt-cbh\\STAGING\\data\\x'),true);
 assert.equal(within(STAGING,STAGING),true);
 assert.equal(within(STAGING,'C:\\NIPT-CBH\\staging-old\\data'),false);
 assert.equal(within(STAGING,'C:\\NIPT-CBH\\staging\\..\\production\\data'),false);
});

test('a half-configured boundary is refused rather than ignored',()=>{
 assert.throws(()=>boundaryFromEnv({...staging,NIPT_ENVIRONMENT:'stage'}),code(/ENVIRONMENT_INVALID/));
 assert.throws(()=>boundaryFromEnv({...staging,NIPT_ENVIRONMENT_ROOT:''}),code(/ENVIRONMENT_ROOT_REQUIRED/));
 assert.throws(()=>boundaryFromEnv({...staging,NIPT_ENVIRONMENT_ROOT:'\\\\nas\\staging'}),code(/ENVIRONMENT_ROOT_REQUIRED/));
 assert.throws(()=>boundaryFromEnv({...staging,NIPT_PROTECTED_ROOTS:''}),code(/ENVIRONMENT_PROTECTED_ROOTS_REQUIRED/));
 assert.throws(()=>boundaryFromEnv({...staging,NIPT_PROTECTED_ROOTS:'C:\\NIPT-CBH'}),code(/ENVIRONMENT_ROOTS_OVERLAP/));
 assert.throws(()=>boundaryFromEnv({...staging,NIPT_EXPECTED_PG_PORT:'x'}),code(/ENVIRONMENT_PG_PORT_REQUIRED/));
});

test('staging cannot reach a remote share, a Production folder or anything outside its root',()=>{
 assert.throws(()=>assertPathAllowed('\\\\his-server\\NIPT\\PET',staging),code(/ENVIRONMENT_STAGING_REMOTE_PATH_PROHIBITED/));
 assert.throws(()=>assertPathAllowed('//nas/archive',staging),code(/ENVIRONMENT_STAGING_REMOTE_PATH_PROHIBITED/));
 assert.throws(()=>assertPathAllowed('C:\\NIPT-CBH\\production\\data\\integration\\outbound',staging),code(/ENVIRONMENT_PROTECTED_PATH_PROHIBITED/));
 assert.throws(()=>assertPathAllowed('c:\\nipt-cbh\\PRODUCTION\\data\\files',staging),code(/ENVIRONMENT_PROTECTED_PATH_PROHIBITED/));
 assert.throws(()=>assertPathAllowed('Z:\\HIS\\RES',staging),code(/ENVIRONMENT_STAGING_PATH_OUTSIDE_ROOT/));
 assert.throws(()=>assertPathAllowed('C:\\NIPT-CBH\\staging-copy\\inbound',staging),code(/ENVIRONMENT_STAGING_PATH_OUTSIDE_ROOT/));
 assert.doesNotThrow(()=>assertPathAllowed('C:\\NIPT-CBH\\staging\\data\\integration\\inbound',staging));
});

test('production keeps hospital shares but can never write into Staging',()=>{
 assert.doesNotThrow(()=>assertPathAllowed('\\\\his-server\\NIPT\\PET',production));
 assert.throws(()=>assertPathAllowed('C:\\NIPT-CBH\\staging\\data\\integration\\outbound',production),code(/ENVIRONMENT_PROTECTED_PATH_PROHIBITED/));
});

test('staging archive is only the loopback simulator share; Production archive is unchanged',()=>{
 assert.throws(()=>assertArchiveRootAllowed('\\\\hospital-nas\\NIPT\\archive',staging),code(/ENVIRONMENT_STAGING_ARCHIVE_NOT_LOOPBACK/));
 assert.throws(()=>assertArchiveRootAllowed('C:\\NIPT-CBH\\staging\\data\\nas-sim',staging),code(/ENVIRONMENT_STAGING_ARCHIVE_NOT_LOOPBACK/));
 assert.doesNotThrow(()=>assertArchiveRootAllowed('\\\\localhost\\nipt-staging-archive',staging));
 assert.doesNotThrow(()=>assertArchiveRootAllowed('\\\\127.0.0.1\\nipt-staging-archive\\2026',staging));
 assert.doesNotThrow(()=>assertArchiveRootAllowed('\\\\hospital-nas\\NIPT\\archive',production));
});

test('process start checks the stamp, database, local roots, share policy and archive',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'nipt-boundary-'));
 // a real directory for the stamp; the Windows-shaped protected root is a sibling that never exists
 const root=path.join(dir,'staging'),env={...staging,NIPT_ENVIRONMENT_ROOT:root,NIPT_PROTECTED_ROOTS:path.join(dir,'production')};
 try{
  await mkdir(path.join(root,'config'),{recursive:true});
  assert.throws(()=>assertProcessBoundary(env),code(/ENVIRONMENT_STAMP_MISSING/));
  await writeFile(path.join(root,'environment.json'),JSON.stringify({format:STAMP_FORMAT,environment:'production'}));
  assert.throws(()=>assertProcessBoundary(env),code(/ENVIRONMENT_STAMP_MISMATCH/));
  await writeFile(path.join(root,'environment.json'),JSON.stringify({format:STAMP_FORMAT,environment:'staging'}));
  const policy=path.join(root,'config','share-policy.json');
  await writeFile(policy,JSON.stringify({version:1,grants:[{root:path.join(root,'data','integration','inbound')}]}));
  const ok={...env,NIPT_HIS_SHARE_POLICY_FILE:policy,DATABASE_URL:'postgresql://nipt_web:x@127.0.0.1:55442/nipt_operational_nipt_staging',FILE_STORE_ROOT:path.join(root,'data','files')};
  assert.equal(assertProcessBoundary(ok).name,'staging');
  assert.throws(()=>assertProcessBoundary({...ok,DATABASE_URL:'postgresql://nipt_web:x@127.0.0.1:55432/nipt_operational_nipt_cbh'}),code(/ENVIRONMENT_DATABASE_PORT_MISMATCH/));
  assert.throws(()=>assertProcessBoundary({...ok,DATABASE_URL:'postgresql://nipt_web:x@192.168.1.5:55442/db'}),code(/ENVIRONMENT_DATABASE_NOT_LOOPBACK/));
  assert.throws(()=>assertProcessBoundary({...ok,FILE_STORE_ROOT:path.join(dir,'production','data','files')}),code(/ENVIRONMENT_FILE_STORE_ROOT_OUTSIDE_ROOT/));
  assert.throws(()=>assertProcessBoundary({...ok,NIPT_HIS_SHARE_POLICY_ENFORCE:'0'}),code(/ENVIRONMENT_STAGING_SHARE_POLICY_NOT_ENFORCED/));
  assert.throws(()=>assertProcessBoundary({...ok,FINAL_REPORT_ARCHIVE_ENABLED:'true',FINAL_REPORT_ARCHIVE_ROOT:'\\\\hospital-nas\\archive'}),code(/ENVIRONMENT_STAGING_ARCHIVE_NOT_LOOPBACK/));
  await writeFile(policy,JSON.stringify({version:1,grants:[{root:'\\\\his-server\\NIPT\\RES'}]}));
  assert.throws(()=>assertProcessBoundary(ok),code(/ENVIRONMENT_STAGING_REMOTE_PATH_PROHIBITED/));
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('staging fails closed without any firewall rule: every refusal above is the application itself',()=>{
 // no process, port or firewall is involved in these decisions; they hold on a host where provision-identities.ps1 never ran
 for(const p of ['\\\\his-server\\NIPT\\PET','\\\\his-server\\NIPT\\RES\\OK','\\\\10.0.0.9\\nas\\pdf','//nas/archive','Z:\\HIS'])
  assert.throws(()=>assertPathAllowed(p,staging),code(/ENVIRONMENT_STAGING_(REMOTE_PATH_PROHIBITED|PATH_OUTSIDE_ROOT)/),p);
 assert.throws(()=>assertArchiveRootAllowed('\\\\10.0.0.9\\nas\\archive',staging),code(/ENVIRONMENT_STAGING_ARCHIVE_NOT_LOOPBACK/));
});

test('a junction, link or loopback admin share cannot alias Production or a share into Staging',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'nipt-alias-'));
 const root=path.join(dir,'staging'),prod=path.join(dir,'production');
 const env={...staging,NIPT_ENVIRONMENT_ROOT:root,NIPT_PROTECTED_ROOTS:prod};
 try{
  await mkdir(path.join(root,'data','integration'),{recursive:true});await mkdir(path.join(prod,'data','files'),{recursive:true});
  // inside the Staging root by name, inside Production in reality ('junction' on Windows needs no privilege; a directory symlink elsewhere)
  const link=path.join(root,'data','integration','outbound');
  await symlink(path.join(prod,'data','files'),link,'junction');
  assert.throws(()=>assertPathAllowed(link,env),code(/ENVIRONMENT_PROTECTED_PATH_PROHIBITED/));
  assert.throws(()=>assertPathAllowed(path.join(link,'res','new-file.res'),env),code(/ENVIRONMENT_PROTECTED_PATH_PROHIBITED/),'a file that does not exist yet below the link');
  await mkdir(path.join(root,'config'),{recursive:true});
  await writeFile(path.join(root,'environment.json'),JSON.stringify({format:STAMP_FORMAT,environment:'staging'}));
  const policy=path.join(root,'config','share-policy.json');await writeFile(policy,JSON.stringify({version:1,grants:[]}));
  assert.throws(()=>assertProcessBoundary({...env,NIPT_HIS_SHARE_POLICY_FILE:policy,FILE_STORE_ROOT:link}),code(/ENVIRONMENT_FILE_STORE_ROOT_(OUTSIDE_ROOT|IN_PROTECTED_ROOT)/));
  assert.doesNotThrow(()=>assertPathAllowed(path.join(root,'data','integration','inbound'),env));
 }finally{await rm(dir,{recursive:true,force:true});}
 // a loopback share is allowed for the archive simulator only under its own name, never an administrative share
 assert.throws(()=>assertArchiveRootAllowed('\\\\localhost\\C$\\NIPT-CBH\\production\\data\\files',staging),code(/ENVIRONMENT_STAGING_ARCHIVE_SHARE_NOT_SIMULATOR/));
 assert.throws(()=>assertArchiveRootAllowed('\\\\127.0.0.1\\ADMIN$\\x',staging),code(/ENVIRONMENT_STAGING_ARCHIVE_SHARE_NOT_SIMULATOR/));
 assert.throws(()=>assertArchiveRootAllowed('\\\\localhost\\nipt-production-archive',staging),code(/ENVIRONMENT_STAGING_ARCHIVE_SHARE_NOT_SIMULATOR/));
 assert.throws(()=>assertPathAllowed('\\\\?\\UNC\\his-server\\NIPT\\PET',staging),code(/ENVIRONMENT_STAGING_REMOTE_PATH_PROHIBITED/));
});

test('a stamped root cannot be turned back into an unrestricted installation by editing its configuration',()=>{
 const stamp=e=>JSON.stringify({format:STAMP_FORMAT,environment:e});
 assert.equal(environmentStampProblem(stamp('staging'),{environment:'staging'}),null);
 assert.equal(environmentStampProblem(stamp('staging'),{}),'ENVIRONMENT_STAMP_CONFIG_MISMATCH');
 assert.equal(environmentStampProblem(stamp('staging'),{environment:'production'}),'ENVIRONMENT_STAMP_CONFIG_MISMATCH');
 assert.equal(environmentStampProblem(null,{environment:'staging'}),'ENVIRONMENT_STAMP_MISSING');
 assert.equal(environmentStampProblem('{bad',{environment:'staging'}),'ENVIRONMENT_STAMP_INVALID');
 assert.equal(environmentStampProblem(null,{}),null); // legacy installation: unchanged
});

const base={instance:'nipt-staging',mode:'operational',database:'nipt_operational_nipt_staging',ports:{postgres:55442,web:3010,https:8443,renderer:3011},origin:'https://localhost:8443',taskMode:'user',excelMode:'direct'};
test('installer configuration pins each environment to its profile and protected roots',()=>{
 assert.doesNotThrow(()=>validateConfig({...base,testEnvironmentOnly:true}));
 assert.doesNotThrow(()=>validateConfig({...base,testEnvironmentOnly:true,environment:'staging',protectedRoots:[PRODUCTION]}));
 assert.throws(()=>validateConfig({...base,testEnvironmentOnly:false,environment:'staging',protectedRoots:[PRODUCTION]}),code(/CONFIG_ENVIRONMENT_PROFILE_MISMATCH/));
 assert.throws(()=>validateConfig({...base,testEnvironmentOnly:true,environment:'production',protectedRoots:[STAGING]}),code(/CONFIG_ENVIRONMENT_PROFILE_MISMATCH/));
 assert.throws(()=>validateConfig({...base,testEnvironmentOnly:true,environment:'staging'}),code(/CONFIG_PROTECTED_ROOTS_REQUIRED/));
 assert.throws(()=>validateConfig({...base,testEnvironmentOnly:true,environment:'uat',protectedRoots:[PRODUCTION]}),code(/CONFIG_ENVIRONMENT_INVALID/));
});

test('the supervisor gives Staging an enforced share policy and Production none of the Staging restrictions',()=>{
 const s=environmentVariables({...base,testEnvironmentOnly:true,environment:'staging',protectedRoots:[PRODUCTION]},STAGING);
 assert.equal(s.NIPT_ENVIRONMENT,'staging');assert.equal(s.NIPT_HIS_SHARE_POLICY_ENFORCE,'1');assert.equal(s.NIPT_EXPECTED_PG_PORT,'55442');assert.equal(s.NIPT_PROTECTED_ROOTS,PRODUCTION);
 const p=environmentVariables({...base,ports:{...base.ports,postgres:55432},testEnvironmentOnly:false,environment:'production',protectedRoots:[STAGING]},PRODUCTION);
 assert.equal(p.NIPT_ENVIRONMENT,'production');assert.equal(p.NIPT_HIS_SHARE_POLICY_ENFORCE,undefined);
 assert.deepEqual(environmentVariables({...base,testEnvironmentOnly:true},STAGING),{});
 // supervisor/admin (installed admin\ folder) and the services (tools\) must agree on the stamp format
 assert.equal(ENVIRONMENT_STAMP_FORMAT,STAMP_FORMAT);
});
