import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateEnvironment,validateEnvironmentPair,releaseId,payloadDigest,destructiveStatements,productionGate,ENVIRONMENT_FORMAT,VERIFIED_FORMAT} from '../../deploy/windows/deploy-gates.mjs';
import {parseVersion,compareVersions} from '../../tools/win-installer/lib.mjs';

const examples=async()=>({staging:JSON.parse(await readFile('deploy/windows/environments/staging.example.json','utf8')),production:JSON.parse(await readFile('deploy/windows/environments/production.example.json','utf8'))});
const code=re=>({message:re});

test('the shipped environment templates are valid for Staging, separate and credential-free',async()=>{
 const {staging,production}=await examples();
 assert.equal(validateEnvironmentPair(staging,production).ok,true);
 assert.deepEqual(production.bootstrap,{adminUser:'',adminName:''}); // one APP_ADMIN, named by the owner
 const text=JSON.stringify([staging,production]).toLowerCase();
 for(const word of ['password','secret','token','postgresql://'])assert.equal(text.includes(word),false,word);
});

test('environments may not share a root, instance, port, signing key or service account',async()=>{
 const {staging,production}=await examples();
 assert.throws(()=>validateEnvironmentPair({...staging,root:'C:\\NIPT-CBH\\production\\staging'},production),code(/ENVIRONMENT_ROOTS_OVERLAP/));
 assert.throws(()=>validateEnvironmentPair({...staging,instance:production.instance},production),code(/ENVIRONMENT_INSTANCE_SHARED/));
 assert.throws(()=>validateEnvironmentPair({...staging,ports:{...staging.ports,postgres:production.ports.postgres}},production),code(/ENVIRONMENT_PORT_SHARED/));
 assert.throws(()=>validateEnvironmentPair({...staging,signingKey:production.signingKey},production),code(/ENVIRONMENT_SIGNING_KEY_SHARED/));
 assert.throws(()=>validateEnvironmentPair({...staging,serviceAccount:production.serviceAccount.toUpperCase()},production),code(/ENVIRONMENT_SERVICE_ACCOUNT_SHARED/));
 assert.throws(()=>validateEnvironmentPair(staging,{...production,signingKey:production.root+'\\keys\\production-signing-private.pem'}),code(/ENVIRONMENT_SIGNING_KEY_INSIDE_RUNTIME_ROOT/));
});

test('profile, Excel and Production bootstrap rules are enforced per environment',async()=>{
 const {staging,production}=await examples();
 assert.throws(()=>validateEnvironment({...staging,profile:'production'},'staging'),code(/ENVIRONMENT_PROFILE_MISMATCH/));
 assert.throws(()=>validateEnvironment({...production,profile:'test'},'production'),code(/ENVIRONMENT_PROFILE_MISMATCH/));
 assert.throws(()=>validateEnvironment({...staging,excelMode:'direct'},'staging'),code(/ENVIRONMENT_SERVICE_ACCOUNT_REQUIRES_EXCEL_BRIDGE/));
 // owner decision 2026-11-01: exactly ONE first account (APP_ADMIN)
 const real={adminUser:'lab.admin',adminName:'Lab Administrator'};
 const P={purpose:'production'};
 assert.doesNotThrow(()=>validateEnvironment({...production,bootstrap:real},'production',P));
 assert.throws(()=>validateEnvironment({...production,bootstrap:{...real,checkerUser:'clin.approver',checkerName:'Clinical Approver'}},'production',P),code(/PRODUCTION_SINGLE_ADMIN_BOOTSTRAP_ONLY/));
 assert.doesNotThrow(()=>validateEnvironment({...production,bootstrap:{...real,checkerUser:'',checkerName:''}},'production',P)); // an emptied legacy field is harmless
 assert.throws(()=>validateEnvironment({...production,bootstrap:{}},'production',P),code(/PRODUCTION_BOOTSTRAP_IDENTITY_REQUIRED/));
 assert.throws(()=>validateEnvironment({...production,bootstrap:{...real,adminUser:'replace.admin'}},'production',P),code(/PRODUCTION_BOOTSTRAP_IDENTITY_REQUIRED/));
 assert.throws(()=>validateEnvironment({...production,bootstrap:{...real,adminUser:'Lab Admin'}},'production',P),code(/PRODUCTION_BOOTSTRAP_USERNAME_INVALID/));
 // the shipped template carries no identities: it cannot be used for Production as-is, but does not hold Staging up
 assert.throws(()=>validateEnvironmentPair(staging,production,P),code(/PRODUCTION_BOOTSTRAP_IDENTITY_REQUIRED/));
 assert.equal(validateEnvironmentPair(staging,{...production,bootstrap:real},P).ok,true);
 assert.throws(()=>validateEnvironmentPair(staging,production,{purpose:'uat'}),code(/ENVIRONMENT_PURPOSE_INVALID/));
 assert.throws(()=>validateEnvironment({...staging,format:'x'},'staging'),code(/ENVIRONMENT_FORMAT_INVALID/));
 assert.throws(()=>validateEnvironment({...production,requireStagingJourney:false},'production'),code(/PRODUCTION_STAGING_UAT_CANNOT_BE_DISABLED/));
 assert.equal(staging.format,ENVIRONMENT_FORMAT);
});

test('release IDs are valid installer versions that order deployments in time and across application versions',()=>{
 const sha='1ad1f340bde071549f004b091de498c10fb5beb8';
 const a=releaseId('1.1.2',sha,new Date('2026-11-01T08:15:30Z')),b=releaseId('1.1.2','b5a62ff69494a4a03287b255816b7058e9a6d45f',new Date('2026-11-01T08:15:31Z'));
 assert.equal(a,'1.1.2-d20261101081530.1ad1f34');
 assert.doesNotThrow(()=>parseVersion(a));
 assert.equal(compareVersions(b,a),1);
 assert.equal(compareVersions(releaseId('1.1.3',sha,new Date('2026-01-01T00:00:00Z')),b),1);
 assert.throws(()=>releaseId('v1.1.2',sha),code(/APP_VERSION_INVALID/));
 assert.throws(()=>releaseId('1.1.2','1ad1f34'),code(/COMMIT_SHA_REQUIRED/));
});

test('payload digest covers exactly the release folder',()=>{
 const m={files:{'installer/nipt-admin.mjs':'1','payload/runtime/node/node.exe':'2','payload/release/app/server.js':'3','payload/release/release.json':'4'}};
 const d=payloadDigest(m);
 assert.equal(payloadDigest({files:{...m.files,'installer/nipt-admin.mjs':'changed','payload/runtime/node/node.exe':'changed'}}),d);
 assert.notEqual(payloadDigest({files:{...m.files,'payload/release/app/server.js':'changed'}}),d);
 assert.throws(()=>payloadDigest({files:{'installer/a':'1'}}),code(/PACKAGE_RELEASE_PAYLOAD_EMPTY/));
});

test('destructive SQL is detected, comments are not',()=>{
 assert.deepEqual(destructiveStatements('CREATE TABLE a(x int);\n-- DROP TABLE a;\n/* TRUNCATE a */ CREATE INDEX i ON a(x);'),[]);
 assert.equal(destructiveStatements('ALTER TABLE a DROP COLUMN x;').length,1);
 assert.equal(destructiveStatements('delete from audit_log where true;').length,1);
 assert.equal(destructiveStatements('ALTER TABLE a ALTER COLUMN x TYPE bigint;').length,1);
 assert.equal(destructiveStatements('TRUNCATE pgboss.job;').length,1);
});

const commit='1ad1f340bde071549f004b091de498c10fb5beb8';
const release={migrationsSha256:'m'.repeat(64),migrations:{'001_a.sql':'h1','002_b.sql':'h2','003_c.sql':'h3'}};
const verified={format:VERIFIED_FORMAT,commit,outcome:'SUCCEEDED',health:{ok:true},verifiedAt:'2026-11-01T00:00:00Z',payloadDigest:'p'.repeat(64),migrationsSha256:release.migrationsSha256,
 journey:{passed:true,commit},schema:{ok:true,ledger:[{name:'001_a.sql',checksum:'h1'},{name:'002_b.sql',checksum:'h2'},{name:'003_c.sql',checksum:'h3'}]}};
const gate=(over={})=>productionGate({verified,commit,now:'2026-11-03T00:00:00Z',maxAgeDays:14,requireJourney:true,payloadDigest:'p'.repeat(64),release,onReleaseBranch:true,
 approvedBy:'Owner',changeReference:'CR-1',confirmation:'DEPLOY PRODUCTION 1ad1f34',productionLedger:[{name:'001_a.sql',checksum:'h1'}],pendingSql:{'002_b.sql':'CREATE TABLE b(x int);','003_c.sql':'CREATE INDEX c ON b(x);'},...over});
const codes=r=>r.failures.map(f=>f.code);

test('a Staging-verified, approved, rehearsed commit passes the Production gate',()=>{
 const r=gate();assert.equal(r.ok,true,JSON.stringify(r.failures));assert.deepEqual(r.pending,['002_b.sql','003_c.sql']);
});

test('Production refuses an unverified, stale, different, unapproved or unconfirmed release',()=>{
 // every failure is reported: without a Staging record the pending migrations are also unrehearsed
 assert.deepEqual(codes(gate({verified:null})),['STAGING_VERIFICATION_MISSING','PRODUCTION_MIGRATION_NOT_REHEARSED_ON_STAGING']);
 assert.ok(codes(gate({verified:{...verified,outcome:'FAILED'}})).includes('STAGING_DEPLOYMENT_NOT_HEALTHY'));
 assert.ok(codes(gate({now:'2026-12-01T00:00:00Z'})).includes('STAGING_VERIFICATION_TOO_OLD'));
 assert.ok(codes(gate({verified:{...verified,journey:{passed:false,commit}}})).includes('STAGING_WORKFLOW_UAT_NOT_PASSED'));
 assert.ok(codes(gate({payloadDigest:'q'.repeat(64)})).includes('PRODUCTION_PAYLOAD_DIFFERS_FROM_STAGING_VERIFIED'));
 assert.ok(codes(gate({commit:'b'.repeat(40),confirmation:'DEPLOY PRODUCTION bbbbbbb'})).includes('STAGING_VERIFIED_COMMIT_MISMATCH'));
 assert.ok(codes(gate({onReleaseBranch:false})).includes('COMMIT_NOT_ON_RELEASE_BRANCH'));
 assert.ok(codes(gate({approvedBy:''})).includes('RELEASE_APPROVER_REQUIRED'));
 assert.ok(codes(gate({changeReference:undefined})).includes('CHANGE_REFERENCE_REQUIRED'));
 assert.ok(codes(gate({confirmation:'yes'})).includes('PRODUCTION_CONFIRMATION_PHRASE_REQUIRED'));
});

test('Production refuses an incompatible ledger, an unrehearsed migration and an unapproved destructive one',()=>{
 assert.ok(codes(gate({productionLedger:[{name:'001_a.sql',checksum:'tampered'}]})).includes('PRODUCTION_SCHEMA_INCOMPATIBLE'));
 assert.ok(codes(gate({productionLedger:[{name:'001_a.sql',checksum:'h1'},{name:'099_newer.sql',checksum:'x'}]})).includes('PRODUCTION_SCHEMA_INCOMPATIBLE'));
 const notRehearsed=gate({verified:{...verified,schema:{ok:true,ledger:[{name:'001_a.sql',checksum:'h1'},{name:'002_b.sql',checksum:'h2'}]}}});
 assert.deepEqual(notRehearsed.failures.find(f=>f.code==='PRODUCTION_MIGRATION_NOT_REHEARSED_ON_STAGING').detail.notRehearsed,['003_c.sql']);
 const drop={pendingSql:{'002_b.sql':'ALTER TABLE a DROP COLUMN x;','003_c.sql':'SELECT 1;'}};
 assert.ok(codes(gate(drop)).includes('DESTRUCTIVE_MIGRATION_REQUIRES_EXPLICIT_APPROVAL'));
 assert.equal(gate({...drop,allowDestructive:['002_b.sql']}).ok,true);
});

test('Production stays blocked until Staging has been installed AND has passed the real workflow',()=>{
 // never deployed to Staging: no record at all, whatever else is in order
 assert.equal(gate({verified:null,productionLedger:null}).ok,false);
 assert.ok(codes(gate({verified:null,productionLedger:null})).includes('STAGING_VERIFICATION_MISSING'));
 // deployed and healthy on Staging, but the installed workflow journey never ran
 assert.ok(codes(gate({verified:{...verified,journey:null}})).includes('STAGING_WORKFLOW_UAT_NOT_PASSED'));
 // a journey recorded for a different commit does not count
 assert.ok(codes(gate({verified:{...verified,journey:{passed:true,commit:'b'.repeat(40)}}})).includes('STAGING_WORKFLOW_UAT_NOT_PASSED'));
 // the requirement cannot be switched off: neither by omission nor by an explicit false
 assert.ok(codes(gate({verified:{...verified,journey:null},requireJourney:undefined})).includes('STAGING_WORKFLOW_UAT_NOT_PASSED'));
 assert.ok(codes(gate({verified:{...verified,journey:null},requireJourney:false})).includes('STAGING_WORKFLOW_UAT_NOT_PASSED'));
});

test('a release verified on Staging stays promotable while Staging is stopped (live Staging state is not a gate input)',()=>{
 for(const stagingState of ['STOPPED','RUNNING',undefined])assert.equal(gate({stagingState,stagingRunning:false}).ok,true,String(stagingState));
});

test('first Production install lists every migration as pending',()=>{
 const r=gate({productionLedger:null});assert.equal(r.ok,true);assert.equal(r.firstInstall,true);assert.deepEqual(r.pending,['001_a.sql','002_b.sql','003_c.sql']);
});
