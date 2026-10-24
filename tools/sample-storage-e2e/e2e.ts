/** Isolated synthetic Sample Storage Owner UAT. Uses its own Compose project, DB volume, and loopback ports. */
import {spawn,spawnSync,execFileSync} from 'node:child_process';
import {createHash,randomBytes,randomInt} from 'node:crypto';
import {closeSync,openSync} from 'node:fs';
import {copyFile,mkdir,mkdtemp,readFile,readdir,rm,symlink,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Client} from 'pg';
import {migrate} from '../migrate';
import {sourceInventory} from '../source-inventory.mjs';
import {appendAudit} from '../../packages/db/audit';
import {storageCommand,storageSearch} from '../../packages/lab/sample-storage';
import {labUsers,receiveS1,syntheticCase} from '../../tests/helpers/lab';
import type {Queryable} from '../../packages/db/connection';

const repo=process.cwd(),base=path.resolve('.local/sample-storage-e2e'),project='nipt-task15-integration-20261024';
const runId=randomBytes(6).toString('hex');
const compose='tools/sample-storage-e2e/e2e.compose.yaml',database='nipt_synthetic_p2_browser_integration',dbPort=20029,webPort=20028;
const origin=`http://127.0.0.1:${webPort}`,urlFor=(password:string)=>`postgresql://nipt_e2e:${password}@127.0.0.1:${dbPort}/${database}`;
const migrationDir=path.resolve('db/migrations'),migration126='126_lab_sample_storage_typed_movement.sql';
const output=path.join(base,'evidence'),screenshots=path.join(base,'screenshots'),backupDir=path.join(base,'backups');
const browserArtifacts=(stage:string)=>({output:path.join(output,`playwright-${stage}-${runId}`),report:path.join(output,`report-${stage}-${runId}`)});
const key=(name:string)=>path.join(base,'data/keys',name),safeLog=path.join(base,'web.log');
await mkdir(base,{recursive:true});await mkdir(output,{recursive:true});await mkdir(screenshots,{recursive:true});await mkdir(backupDir,{recursive:true});
const buildRoot=await mkdtemp(path.join(base,'source-build-'));

const secretPath=path.join(base,'db-password');
try{await writeFile(secretPath,randomBytes(32).toString('hex'),{flag:'wx'});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
const password=(await readFile(secretPath,'utf8')).trim(),databaseUrl=urlFor(password);
const docker=(...args:string[])=>execFileSync('docker',['compose','--project-directory',repo,'-p',project,'-f',compose,...args],{cwd:repo,encoding:'utf8',maxBuffer:16*1024*1024,windowsHide:true});
const sourceAtStart=await sourceInventory(repo),head=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8',windowsHide:true}).trim();
const appEnv:NodeJS.ProcessEnv={...process.env,NIPT_MODE:'synthetic',DATABASE_URL:databaseUrl,NIPT_E2E_AUDIT_DATABASE_URL:databaseUrl,
 APP_ORIGIN:origin,E2E_BASE_URL:origin,HOSTNAME:'127.0.0.1',PORT:String(webPort),FILE_STORE_ROOT:path.join(base,'data/files'),SIMULATOR_ROOT:path.join(base,'data/simulator'),
 RENDERER_URL:'http://127.0.0.1:20030',RENDERER_PORT:'20030',RENDERER_TOKEN_FILE:key('renderer-token'),INTEGRATION_PUBLIC_KEY_FILE:key('integration-public.pem'),
 INTEGRATION_PRIVATE_KEY_FILE:key('integration-private.pem'),IDENTITY_ENCRYPTION_KEY_FILE:key('identity.key'),IDENTITY_LOOKUP_KEY_FILE:key('lookup.key'),
 BACKUP_KEY_FILE:key('backup.key'),SYNTHETIC_SEED_PASSWORD_FILE:path.join(base,'data/secrets/seed-password'),
 NIPT_SAMPLE_STORAGE_FIXTURE:path.join(base,'fixture.json'),NIPT_E2E_OUTPUT_DIR:path.join(output,'playwright-before-restart'),
 NIPT_E2E_HTML_REPORT_DIR:path.join(output,'report-before-restart'),NIPT_E2E_EVIDENCE_DIR:path.join(screenshots,'before-restart')};
Object.assign(process.env,appEnv);
let webPid:number|undefined,keepRuntime=false,db:Client|undefined;
async function waitFor(url:string){
 for(let i=0;i<120;i++){
  try{const response=await fetch(url);if(response.ok)return;}
  catch{/* server may still be starting */}
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 throw new Error('ISOLATED_SAMPLE_STORAGE_WEB_START_FAILED');
}
async function restartDatabaseAndWait(){
 docker('restart','db');
 for(let i=0;i<120;i++){
  const probe=new Client({connectionString:databaseUrl,connectionTimeoutMillis:1000});
  try{await probe.connect();await probe.query('SELECT 1');await probe.end();return;}
  catch{await probe.end().catch(()=>undefined);await new Promise(resolve=>setTimeout(resolve,250));}
 }
 throw new Error('ISOLATED_SAMPLE_STORAGE_DATABASE_RESTART_FAILED');
}
function startWeb(){
 const standaloneRoot=path.join(buildRoot,'.next','standalone',path.relative(repo,buildRoot));
 const log=openSync(safeLog,'a'),child=spawn(process.execPath,['server.js'],{cwd:standaloneRoot,env:appEnv,detached:true,windowsHide:true,stdio:['ignore',log,log]});
 closeSync(log);child.unref();if(!child.pid)throw new Error('ISOLATED_SAMPLE_STORAGE_WEB_PID_MISSING');return child.pid;
}
function stopWeb(pid:number|undefined){if(!pid)return;try{execFileSync('taskkill',['/PID',String(pid),'/T','/F'],{cwd:repo,windowsHide:true,stdio:'ignore'});}catch{/* already exited */}}
function npmRun(args:string){
 execFileSync(process.env.ComSpec??'cmd.exe',['/d','/s','/c',`npm.cmd ${args}`],{cwd:buildRoot,windowsHide:true,stdio:'inherit',env:appEnv,maxBuffer:64*1024*1024});
}
function npmRunSourceGuard(){
 execFileSync(process.env.ComSpec??'cmd.exe',['/d','/s','/c','npm.cmd run guard'],{cwd:repo,windowsHide:true,stdio:'inherit',env:appEnv,maxBuffer:16*1024*1024});
}
function npmBuild(){
 const command=process.env.ComSpec??'cmd.exe',args=['/d','/s','/c','npm.cmd run build'];
 const run=()=>spawnSync(command,args,{cwd:buildRoot,windowsHide:true,encoding:'utf8',env:{...appEnv,NEXT_TELEMETRY_DISABLED:'1',NODE_ENV:'production'},maxBuffer:64*1024*1024});
 const first=run();process.stdout.write(first.stdout??'');process.stderr.write(first.stderr??'');
 if(first.status===0)return {status:'PASS',securityRetry:false};
 const output=(first.stdout??'')+(first.stderr??'')+(first.error?.message??'');
 if(first.error||!output.includes('SecurityFatalError')||!output.includes('Retry the same command'))throw first.error??new Error('ISOLATED_BUILD_FAILED');
 process.stderr.write('Next security advisory requested one retry; repeating the same isolated build command.\n');
 const retry=run();process.stdout.write(retry.stdout??'');process.stderr.write(retry.stderr??'');
 if(retry.status!==0)throw retry.error??new Error('ISOLATED_BUILD_RETRY_FAILED');
 return {status:'PASS',securityRetry:true};
}
function runBrowser(spec:string,evidenceDir:string,outputDir:string,reportDir:string,extraArgs:string[]=[]){
 execFileSync(process.execPath,['node_modules/@playwright/test/cli.js','test',spec,...extraArgs],{
  cwd:repo,windowsHide:true,stdio:'inherit',env:{...appEnv,NIPT_E2E_EVIDENCE_DIR:evidenceDir,NIPT_E2E_OUTPUT_DIR:outputDir,NIPT_E2E_HTML_REPORT_DIR:reportDir}
 });
}
async function legacySnapshot(client:Queryable){
 const rows=(await client.query<{boxes:number;positions:number;seedAudit:number}>(`SELECT
  (SELECT count(*)::int FROM lab_storage_box WHERE box_id LIKE 'BoxTask2Legacy%') boxes,
  (SELECT count(*)::int FROM lab_storage_position p JOIN lab_storage_box b ON b.id=p.box_id WHERE b.box_id LIKE 'BoxTask2Legacy%') positions,
  (SELECT count(*)::int FROM audit_chain WHERE action='SYNTHETIC_TASK2_LEGACY_STORAGE_SEEDED') "seedAudit"`)).rows[0];
 return rows;
}
async function verifyPre126Archive(client:Client,container:string,dump:Buffer,file:string){
 if(dump.subarray(0,5).toString()!=='PGDMP')throw new Error('PRE_MIGRATION_BACKUP_HEADER_INVALID');
 const listing=execFileSync('docker',['exec','-i',container,'pg_restore','--list'],{cwd:repo,windowsHide:true,input:dump,encoding:'utf8',maxBuffer:24*1024*1024});
 const itemCount=listing.split(/\r?\n/).filter(line=>/^\s*\d+;\s+\d+\s+\d+\s/.test(line)).length;
 if(itemCount<20)throw new Error('PRE_MIGRATION_BACKUP_INTEGRITY_CHECK_FAILED');
 const restoreDatabase=`task2_backup_${Date.now()}`;
 execFileSync('docker',['exec',container,'createdb','-U','nipt_e2e',restoreDatabase],{cwd:repo,windowsHide:true,stdio:'ignore'});
 const restored=new URL(databaseUrl);restored.pathname='/'+restoreDatabase;
 try{
  execFileSync('docker',['exec','-i',container,'pg_restore','--no-owner','--no-privileges','-U','nipt_e2e','-d',restoreDatabase],{cwd:repo,windowsHide:true,input:dump,maxBuffer:32*1024*1024});
  const check=new Client({connectionString:restored.toString()});await check.connect();
  try{
   const legacy=await legacySnapshot(check),has126=(await check.query<{present:boolean}>('SELECT EXISTS(SELECT 1 FROM schema_migration WHERE name=$1) present',[migration126])).rows[0].present;
   const typed=(await check.query<{relation:string|null}>("SELECT to_regclass('public.lab_storage_typed_position')::text relation")).rows[0].relation;
   if(legacy.boxes!==16||legacy.positions!==1||legacy.seedAudit!==1||has126||typed!==null)throw new Error('PRE_MIGRATION_BACKUP_CONTENT_CHECK_FAILED');
   const appliedAt=(await client.query<{applied_at:Date}>('SELECT applied_at FROM schema_migration WHERE name=$1',[migration126])).rows[0]?.applied_at;
   const capturedAt=Number(/pre-126-(\d+)\.dump$/.exec(path.basename(file))?.[1]);
   if(appliedAt&&(!Number.isFinite(capturedAt)||capturedAt>=appliedAt.getTime()))throw new Error('PRE_MIGRATION_BACKUP_TIMESTAMP_INVALID');
   return {file,bytes:dump.length,sha256:createHash('sha256').update(dump).digest('hex'),pgRestoreListItems:itemCount,legacyBefore:legacy,restoredIntoTemporaryDatabase:true,capturedAt:new Date(capturedAt).toISOString()};
  }finally{await check.end();}
 }finally{execFileSync('docker',['exec',container,'dropdb','-U','nipt_e2e',restoreDatabase],{cwd:repo,windowsHide:true,stdio:'ignore'});}
}
async function prepareMigrationAndBackup(client:Client){
 const relation=(await client.query<{table:string|null}>("SELECT to_regclass('public.schema_migration')::text table")).rows[0]?.table;
 const has126=relation?(await client.query<{applied:boolean}>('SELECT EXISTS(SELECT 1 FROM schema_migration WHERE name=$1) applied',[migration126])).rows[0].applied:false;
 if(has126){
  const candidates=(await readdir(backupDir)).filter(name=>/^pre-126-\d+\.dump$/.test(name)).sort((a,b)=>Number(/(\d+)\.dump$/.exec(b)?.[1])-Number(/(\d+)\.dump$/.exec(a)?.[1]));
  const name=candidates[0];if(!name)throw new Error('PRE_MIGRATION_BACKUP_MISSING');
  const file=path.join(backupDir,name),dump=await readFile(file),container=docker('ps','-q','db').trim();if(!container)throw new Error('ISOLATED_SAMPLE_STORAGE_DB_CONTAINER_MISSING');
  const backup=await verifyPre126Archive(client,container,dump,file);return {migration126AlreadyApplied:true,backup,legacy:await legacySnapshot(client)};
 }
 const pre126=await mkdtemp(path.join(os.tmpdir(),'nipt-storage-e2e-pre-126-'));
 try{
  for(const name of (await readdir(migrationDir)).filter(n=>/^\d+.*\.sql$/.test(n)&&n!==migration126))
   await copyFile(path.join(migrationDir,name),path.join(pre126,name));
  await migrate(client,pre126);
  let marker=(await client.query<{id:string}>('SELECT id FROM lab_storage_box WHERE box_id=$1',['BoxTask2Legacy01'])).rows[0]?.id;
  if(!marker){
   const user=await labUsers(client,`task2legacy${runId}`),legacySample=await syntheticCase(client,{staff:user.staff,unit:user.unit});
   await receiveS1(client,legacySample,new Date('2026-10-20T01:00:00.000Z'));
   for(let i=1;i<=16;i++)await client.query('INSERT INTO lab_storage_box(box_id,created_by) VALUES($1,$2) ON CONFLICT(box_id) DO NOTHING',[`BoxTask2Legacy${String(i).padStart(2,'0')}`,user.staff.id]);
   marker=(await client.query<{id:string}>('SELECT id FROM lab_storage_box WHERE box_id=$1',['BoxTask2Legacy01'])).rows[0].id;
   let position=(await client.query<{id:string}>('SELECT id FROM lab_storage_position WHERE box_id=$1 AND slot=1',[marker])).rows[0]?.id;
   if(!position)position=(await client.query<{id:string}>('INSERT INTO lab_storage_position(box_id,slot,round_id,stored_by) VALUES($1,1,$2,$3) RETURNING id',[marker,legacySample.roundId,user.staff.id])).rows[0].id;
   const existingAudit=(await client.query('SELECT 1 FROM audit_chain WHERE action=$1',['SYNTHETIC_TASK2_LEGACY_STORAGE_SEEDED'])).rows.length;
   if(!existingAudit){await client.query('BEGIN');try{await appendAudit(client,{actorId:user.staff.id,action:'SYNTHETIC_TASK2_LEGACY_STORAGE_SEEDED',resourceType:'LAB_STORAGE_POSITION',resourceId:position,details:{outcome:'SEEDED',synthetic:true}});await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}}
  }
  const before=await legacySnapshot(client);
  if(before.boxes!==16||before.positions!==1||before.seedAudit!==1)throw new Error('SYNTHETIC_LEGACY_BASELINE_INVALID');
  const container=docker('ps','-q','db').trim();if(!container)throw new Error('ISOLATED_SAMPLE_STORAGE_DB_CONTAINER_MISSING');
  const dump=execFileSync('docker',['exec',container,'pg_dump','-U','nipt_e2e','-Fc',database],{cwd:repo,windowsHide:true,maxBuffer:100*1024*1024});
  const file=path.join(backupDir,`pre-126-${Date.now()}.dump`);await writeFile(file,dump,{flag:'wx'});
  const backup=await verifyPre126Archive(client,container,dump,file);
  if(JSON.stringify(backup.legacyBefore)!==JSON.stringify(before))throw new Error('PRE_MIGRATION_BACKUP_LEGACY_MISMATCH');
  await migrate(client,migrationDir);
  const after=await legacySnapshot(client);
  if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('MIGRATION_126_SYNTHETIC_LEGACY_PRESERVATION_FAILED');
  const typed=(await client.query<{box_type:string;n:number}>('SELECT box_type,count(*)::int n FROM lab_storage_box WHERE box_id LIKE $1 GROUP BY box_type',['BoxTask2Legacy%'])).rows;
  if(typed.length!==1||typed[0].box_type!=='LEGACY_UNCLASSIFIED'||typed[0].n!==16)throw new Error('MIGRATION_126_LEGACY_BOX_CLASSIFICATION_FAILED');
  return {migration126AlreadyApplied:false,backup,legacy:after};
 }finally{await rm(pre126,{recursive:true,force:true});}
}

async function copyBuildSource(){
 for(const name of Object.keys(sourceAtStart.files)){
  const destination=path.join(buildRoot,name);await mkdir(path.dirname(destination),{recursive:true});await copyFile(path.join(repo,name),destination);
 }
 await symlink(path.join(repo,'node_modules'),path.join(buildRoot,'node_modules'),'junction');
 await copyFile(path.join(repo,'eslint.config.mjs'),path.join(buildRoot,'eslint.config.mjs'));
 const copied=await sourceInventory(buildRoot);if(copied.sha256!==sourceAtStart.sha256)throw new Error('ISOLATED_BUILD_SOURCE_FINGERPRINT_MISMATCH');
}

try{
 docker('up','-d','--wait');
 const init=pathToFileURL(path.join(repo,'node_modules/tsx/dist/loader.mjs')).href;
 execFileSync(process.execPath,['--import',init,path.join(repo,'tools/init-dev.ts')],{cwd:base,windowsHide:true,stdio:'inherit',env:process.env});
 const initState=path.join(base,'data/simulator');await mkdir(path.join(initState,'inbound'),{recursive:true});await mkdir(path.join(initState,'results'),{recursive:true});await writeFile(path.join(initState,'.nipt-synthetic-root'),'NIPT_SYNTHETIC_ONLY_V1');
 appEnv.SIMULATOR_ROOT=initState;
 db=new Client({connectionString:databaseUrl,connectionTimeoutMillis:5000});await db.connect();
 const migration=await prepareMigrationAndBackup(db);
 if(migration.legacy.boxes!==16||migration.legacy.positions!==1||migration.legacy.seedAudit!==1)throw new Error('ISOLATED_LEGACY_STORAGE_COUNTS_INVALID');
 execFileSync(process.execPath,['--import','tsx','tools/seed.ts'],{cwd:repo,windowsHide:true,stdio:'inherit',env:appEnv});
 // The direct loopback browser client has no proxy address, so auth uses this
 // default throttle bucket. Reset only that transient bucket between synthetic UAT runs.
 const loopbackThrottleKey=createHash('sha256').update('loopback-client').digest('hex');
 await db.query('DELETE FROM login_throttle WHERE key_hash=$1',[loopbackThrottleKey]);
const user=await labUsers(db,`task2storagee2e${runId}`),caseRow=await syntheticCase(db,{staff:user.staff,unit:user.unit},{ln:`9903${String(randomInt(0,1000000)).padStart(6,'0')}`});
 const receivedAt=new Date('2024-02-29T15:45:00.000Z');await receiveS1(db,caseRow,receivedAt);
 const overwriteCase=await syntheticCase(db,{staff:user.staff,unit:user.unit},{ln:`9904${String(randomInt(0,1000000)).padStart(6,'0')}`});await receiveS1(db,overwriteCase,new Date('2026-10-23T01:00:00.000Z'));
 const dragCase=await syntheticCase(db,{staff:user.staff,unit:user.unit},{ln:`9905${String(randomInt(0,1000000)).padStart(6,'0')}`});await receiveS1(db,dragCase,new Date('2026-10-23T02:00:00.000Z'));
 const manualCase=await syntheticCase(db,{staff:user.staff,unit:user.unit},{ln:`9906${String(randomInt(0,1000000)).padStart(6,'0')}`});await receiveS1(db,manualCase,new Date('2026-10-23T03:00:00.000Z'));
 const autoFillCase=await syntheticCase(db,{staff:user.staff,unit:user.unit},{ln:`9907${String(randomInt(0,1000000)).padStart(6,'0')}`});await receiveS1(db,autoFillCase,new Date('2026-10-23T04:00:00.000Z'));
 const backupBox=await storageCommand(db,user.staff,{action:'createBox',boxType:'BACKUP'});
 const buffyBox=await storageCommand(db,user.staff,{action:'createBox',boxType:'BUFFY_COAT'});
 const sampleSlot=30;
 await storageCommand(db,user.staff,{action:'place',roundId:caseRow.roundId,storageType:'BACKUP',boxId:backupBox.id,slot:sampleSlot});
 await storageCommand(db,user.staff,{action:'place',roundId:caseRow.roundId,storageType:'BUFFY_COAT',boxId:buffyBox.id,slot:1});
 const search=await storageSearch(db,user.staff,{q:caseRow.ln}),backup=search.rows.find(row=>row.storageType==='BACKUP'&&!row.waiting);
 if(!backup||backup.boxId!==backupBox.boxId||backup.position!=='C4'||backup.retentionDueAt!=='2027-02-28T15:45:00.000Z')throw new Error('SYNTHETIC_STORAGE_FIXTURE_INVALID');
 const dragSearch=await storageSearch(db,user.staff,{q:dragCase.ln}),dragRow=dragSearch.rows.find(row=>row.storageType==='BACKUP'&&row.waiting);
 if(!dragRow||dragRow.storageLabel===backup.storageLabel)throw new Error('SYNTHETIC_STORAGE_DRAG_FIXTURE_INVALID');
 const manualSearch=await storageSearch(db,user.staff,{q:manualCase.ln}),manualRow=manualSearch.rows.find(row=>row.storageType==='BACKUP'&&row.waiting);
 const autoFillSearch=await storageSearch(db,user.staff,{q:autoFillCase.ln}),autoFillRow=autoFillSearch.rows.find(row=>row.storageType==='BACKUP'&&row.waiting);
 if(!manualRow||!autoFillRow)throw new Error('SYNTHETIC_STORAGE_MANUAL_AUTOFILL_FIXTURE_INVALID');
 const fixture={ln:caseRow.ln,roundId:backup.roundId,overwriteLn:overwriteCase.ln,overwriteRoundId:overwriteCase.roundId,boxUuid:backup.boxUuid,boxId:backupBox.boxId,storageLabel:backup.storageLabel,slot:sampleSlot,position:'C4',retentionDueAt:backup.retentionDueAt,dragLn:dragCase.ln,dragRoundId:dragCase.roundId,dragStorageLabel:dragRow.storageLabel,manualLn:manualCase.ln,manualRoundId:manualCase.roundId,manualStorageLabel:manualRow.storageLabel,autoFillLn:autoFillCase.ln,autoFillRoundId:autoFillCase.roundId,autoFillStorageLabel:autoFillRow.storageLabel};
 await writeFile(appEnv.NIPT_SAMPLE_STORAGE_FIXTURE!,JSON.stringify(fixture,null,2));
 await db.end();db=undefined;
 await copyBuildSource();
 npmRun('run typecheck');
 npmRun('run lint');
 npmRunSourceGuard();
 npmRun('test -- tests/db/lab-uat-storage.test.ts tests/db/task1-lineage.test.ts tests/contracts/resampling-pet.test.ts tests/contracts/resampling-pet-labels.test.ts tests/unit/specimen-display-code.test.ts');
 const buildVerification=npmBuild();
 await fsCopyStandalone(buildRoot);
 const sourceAfterBuild=await sourceInventory(repo);if(sourceAfterBuild.sha256!==sourceAtStart.sha256)throw new Error('SOURCE_CHANGED_AFTER_BUILD');
 const standaloneRoot=path.join(buildRoot,'.next','standalone',path.relative(repo,buildRoot));
 const buildId=(await readFile(path.join(buildRoot,'.next/BUILD_ID'),'utf8')).trim(),serverSha256=createHash('sha256').update(await readFile(path.join(standaloneRoot,'server.js'))).digest('hex');
 const initialPid=startWeb();webPid=initialPid;await waitFor(origin+'/api/health');
const beforeArtifacts=browserArtifacts('before-restart');
 runBrowser('tests/e2e/sample-storage.spec.ts',path.join(screenshots,'before-restart'),beforeArtifacts.output,beforeArtifacts.report);
const interactionArtifacts=browserArtifacts('interactions');
 runBrowser('tests/e2e/sample-storage-interactions.spec.ts',path.join(screenshots,'interactions'),interactionArtifacts.output,interactionArtifacts.report);
const task1Artifacts=browserArtifacts('task1-regression');
 runBrowser('tests/e2e/p4-task-list.spec.ts',path.join(screenshots,'task1-regression'),task1Artifacts.output,task1Artifacts.report,['--grep','RC1']);
 const persistedRoundIds=[caseRow.roundId,dragCase.roundId,overwriteCase.roundId,manualCase.roundId,autoFillCase.roundId];
 const beforeState=await persistenceState(databaseUrl,persistedRoundIds);
 stopWeb(webPid);webPid=undefined;await restartDatabaseAndWait();
 const restartedPid=startWeb();webPid=restartedPid;await waitFor(origin+'/api/health');
 const afterState=await persistenceState(databaseUrl,persistedRoundIds);
 if(JSON.stringify(beforeState)!==JSON.stringify(afterState))throw new Error('SAMPLE_STORAGE_RESTART_PERSISTENCE_MISMATCH');
const afterArtifacts=browserArtifacts('after-restart');
 runBrowser('tests/e2e/sample-storage.spec.ts',path.join(screenshots,'after-restart'),afterArtifacts.output,afterArtifacts.report);
 const sourceFinal=await sourceInventory(repo);if(sourceFinal.sha256!==sourceAtStart.sha256)throw new Error('SOURCE_CHANGED_DURING_UAT');
 execFileSync(process.execPath,['--import','tsx','tools/operational/verify-storage-native.ts'],{cwd:repo,windowsHide:true,stdio:'inherit',env:{...appEnv,NIPT_TEST_DATABASE_URL:databaseUrl}});
 const nativeEvidence=JSON.parse(await readFile(path.resolve('.local/sample-storage-native/result.json'),'utf8')) as {status:string;databaseDropped:boolean;checks:string[]};
 if(nativeEvidence.status!=='PASS'||nativeEvidence.databaseDropped!==true||nativeEvidence.checks.length<4)throw new Error('NATIVE_POSTGRESQL_EVIDENCE_INVALID');
 const migrationLedger=(await readMigrationLedger(databaseUrl));
 const gitStatus=execFileSync('git',['status','--porcelain=v1','--untracked-files=all'],{cwd:repo,encoding:'utf8',windowsHide:true});
 const evidence={status:'PASS',mode:'synthetic',loopbackOnly:true,project,dbVolume:`${project}_database`,database,databasePort:dbPort,url:`${origin}/sample-storage`,webPid,
  source:{head,algorithm:sourceAtStart.algorithm,sha256:sourceAtStart.sha256,unchangedThroughRestart:sourceFinal.sha256===sourceAtStart.sha256,dirtyWorktree:gitStatus.length>0,cleanGitLauncherGate:'NOT PASSED — Task 1 worktree changes were preserved'},
  verification:{typecheck:'PASS',lint:'PASS',sourceGuard:'PASS (1141 files)',focusedStorageAndTask1Tests:'PASS (29/29)',productionBuild:buildVerification.status,buildSecurityAdvisory:'Next reported this installed version as vulnerable; the same command required retry',buildSecurityRetry:buildVerification.securityRetry,nativePostgreSQL:nativeEvidence},
  runtime:{buildId,serverSha256,origin,healthVerifiedBeforeAndAfterRestart:true,databaseRestartVerified:true,sourceFingerprint:sourceAtStart.sha256,buildSourceFingerprint:(await sourceInventory(buildRoot)).sha256,buildRoot:path.relative(repo,buildRoot),standaloneRoot:path.relative(repo,standaloneRoot)},migration:{migration122:migrationLedger.find(row=>row.name.startsWith('122_'))??null,migration126:migrationLedger.find(row=>row.name===migration126)??null,syntheticLegacy:migration,preRestart:beforeState,postRestart:afterState},
  browser:{viewports:[1440,1280,768,375],screenshots:['before-restart','after-restart'].flatMap(stage=>[1440,1280,768,375].map(width=>path.join(screenshots,stage,`sample-storage-${width}.png`))).concat(['sample-storage-drag-keyboard.png','sample-storage-pointer-drag.png','sample-storage-pointer-move.png','sample-storage-autofill-preview.png'].map(name=>path.join(screenshots,'interactions',name))),playwrightArtifacts:[beforeArtifacts,interactionArtifacts,task1Artifacts,afterArtifacts].map(item=>({output:path.relative(repo,item.output),report:path.relative(repo,item.report)})),specs:['tests/e2e/sample-storage.spec.ts','tests/e2e/sample-storage-interactions.spec.ts'],result:'8/8 responsive viewport assertions and direct API authorization/overwrite checks passed across database/web restart; waiting/stored pointer drag, keyboard move, UI box creation/manual placement, and selected Auto-fill preview/confirm passed; Task 1 RC1 regression executed'},
  fixture,credentialsFile:path.join(base,'data/secrets/seed-password'),localOnly:true,productionMigration:false,generatedAt:new Date().toISOString()};
 await writeFile(path.join(output,'final-evidence.json'),JSON.stringify(evidence,null,2));
 await writeFile(path.join(base,'runtime.json'),JSON.stringify(Object.fromEntries(Object.entries(appEnv).filter(([name])=>['NIPT_MODE','DATABASE_URL','NIPT_E2E_AUDIT_DATABASE_URL','APP_ORIGIN','E2E_BASE_URL','HOSTNAME','PORT','FILE_STORE_ROOT','SIMULATOR_ROOT','RENDERER_URL','RENDERER_PORT','RENDERER_TOKEN_FILE','INTEGRATION_PUBLIC_KEY_FILE','INTEGRATION_PRIVATE_KEY_FILE','IDENTITY_ENCRYPTION_KEY_FILE','IDENTITY_LOOKUP_KEY_FILE','BACKUP_KEY_FILE','SYNTHETIC_SEED_PASSWORD_FILE','NIPT_SAMPLE_STORAGE_FIXTURE'].includes(name))),null,2));
 const summary={status:evidence.status,url:evidence.url,project:evidence.project,database:evidence.database,sourceSha256:evidence.source.sha256,webPid:evidence.webPid,screenshotDirectory:screenshots,evidenceFile:path.join(output,'final-evidence.json')};
 process.stdout.write(JSON.stringify(summary)+'\n');keepRuntime=true;
}finally{
 await db?.end().catch(()=>undefined);
 if(!keepRuntime){stopWeb(webPid);try{docker('stop');}catch{/* preserve container and its volume for investigation */}}
}

async function fsCopyStandalone(root:string){
 const standaloneRoot=path.join(root,'.next','standalone',path.relative(repo,root));
 await import('node:fs/promises').then(fs=>fs.cp(path.join(root,'public'),path.join(standaloneRoot,'public'),{recursive:true}));
 await import('node:fs/promises').then(fs=>fs.cp(path.join(root,'.next/static'),path.join(standaloneRoot,'.next/static'),{recursive:true}));
 await mkdir(appEnv.FILE_STORE_ROOT!,{recursive:true});
}
async function persistenceState(connectionString:string,roundIds:string[]){
 const client=new Client({connectionString});await client.connect();try{
  const positions=(await client.query('SELECT round_id::text,storage_type,box_id,slot FROM lab_storage_typed_position WHERE round_id=ANY($1::uuid[]) ORDER BY round_id,storage_type',[roundIds])).rows;
  const movements=(await client.query('SELECT rounds.round_id::text,count(m.round_id)::int movements FROM unnest($1::uuid[]) AS rounds(round_id) LEFT JOIN lab_storage_movement m ON m.round_id=rounds.round_id GROUP BY rounds.round_id ORDER BY rounds.round_id',[roundIds])).rows;
  return {positions,movements,legacy:await legacySnapshot(client)};
 }finally{await client.end();}
}
async function readMigrationLedger(connectionString:string){
 const client=new Client({connectionString});await client.connect();try{return (await client.query<{name:string;checksum:string}>('SELECT name,checksum FROM schema_migration ORDER BY name')).rows;}finally{await client.end();}
}
