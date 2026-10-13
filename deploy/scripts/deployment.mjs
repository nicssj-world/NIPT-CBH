import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,readFile,writeFile,copyFile,readdir,lstat,realpath,unlink} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {verifySignedBundle} from './signed-bundle.mjs';
import {imageContract,migrationInventory,roles,assertImageProvenance} from './release-contract.mjs';
const marker='.nipt-runtime.json';
async function noLinks(target){
 let cursor=path.parse(target).root;
 for(const segment of target.slice(cursor.length).split(path.sep).filter(Boolean)){cursor=path.join(cursor,segment);try{if((await lstat(cursor)).isSymbolicLink())throw Error('RUNTIME_LINK_PROHIBITED');}catch(e){if(e.code!=='ENOENT')throw e;}}
}
function outside(a,b){const rel=path.relative(b,a);return rel!==''&&!(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));}
async function target(env,bundle,action){
 const root=env.NIPT_RUNTIME_ROOT,project=env.NIPT_COMPOSE_PROJECT;
 if(!root||!path.isAbsolute(root)||path.resolve(root)===path.parse(root).root)throw Error('ABSOLUTE_RUNTIME_REQUIRED');
 if(!/^nipt-synthetic-[a-z0-9][a-z0-9-]{2,48}$/.test(project??''))throw Error('SYNTHETIC_PROJECT_REQUIRED');
 const runtime=path.resolve(root);await noLinks(runtime);
 if(!outside(runtime,bundle)||!outside(bundle,runtime))throw Error('RUNTIME_MUST_BE_SEPARATE_FROM_BUNDLE');
 let state=null,failedState=null,markerSnapshot=null;
 if(action==='install'){try{await lstat(runtime);throw Error('RUNTIME_NOT_FRESH');}catch(e){if(e.code!=='ENOENT')throw e;}}
 else if(action!=='preflight'){
  state=JSON.parse(await readFile(path.join(runtime,marker),'utf8'));
  markerSnapshot=JSON.stringify(state);
  if(state.status==='FAILED'&&action==='rollback'){
   failedState=state;state=state.lastStartedState;
   if(!state)throw Error('FAILED_INSTALL_HAS_NO_PRIOR_RUNTIME');
  }
  if(state.syntheticOnly!==true||state.runtimeRoot!==runtime||state.project!==project||state.status!=='STARTED_NOT_ACCEPTED')throw Error('MANAGED_SYNTHETIC_RUNTIME_REQUIRED');
  await noLinks(path.join(runtime,'data'));await noLinks(path.join(runtime,'compose.yaml'));
 }
 const port=Number(env.NIPT_HTTPS_PORT??state?.port??8443);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('LOOPBACK_PORT_INVALID');
 if(state&&port!==state.port)throw Error('RUNTIME_PORT_CHANGE_REQUIRES_REVIEW');
 return {runtime,project,port,state,failedState,markerSnapshot};
}
async function verifiedBackup(env,t){
 if(env.BACKUP_VERIFIED!=='yes'||!env.NIPT_BACKUP_EVIDENCE)throw Error('VERIFIED_BACKUP_EVIDENCE_REQUIRED');
 const record=JSON.parse(await readFile(env.NIPT_BACKUP_EVIDENCE,'utf8'));
 if(record.syntheticOnly!==true||record.restoreVerified!==true||record.runtimeRoot!==t.runtime||record.project!==t.project||record.sourceRevision!==t.state.revision||!path.isAbsolute(record.archive??'')||!/^[a-f0-9]{64}$/.test(record.sha256??''))throw Error('BACKUP_TARGET_OR_RESTORE_EVIDENCE_INVALID');
 const hash=createHash('sha256');for await(const chunk of createReadStream(record.archive))hash.update(chunk);if(hash.digest('hex')!==record.sha256)throw Error('BACKUP_CHECKSUM_MISMATCH');
 return record.sha256;
}
export async function deploy(action,{env=process.env,bundleRoot=process.cwd(),docker}={}){
 if(!['preflight','install','upgrade','rollback'].includes(action))throw Error('DEPLOY_ACTION_INVALID');
 if(env.NIPT_MODE!=='synthetic')throw Error('SYNTHETIC_MODE_REQUIRED');
 if(!env.NIPT_TRUSTED_TOOLS||!env.TRUSTED_RELEASE_PUBLIC_KEY)throw Error('INDEPENDENT_TRUST_REQUIRED');
 if(action==='rollback'&&(!path.isAbsolute(env.PREVIOUS_BUNDLE??'')||env.SCHEMA_COMPATIBLE_WITH_PREVIOUS!=='yes'))throw Error('COMPATIBLE_PREVIOUS_BUNDLE_REQUIRED');
 const bundle=await realpath(action==='rollback'?env.PREVIOUS_BUNDLE:bundleRoot);
 // Only independently provisioned code executes before these media checks.
 const manifest=await verifySignedBundle(bundle,env.TRUSTED_RELEASE_PUBLIC_KEY),ids=imageContract(manifest);
 const inventory=await migrationInventory(path.join(bundle,'migrations'));
 if(inventory.sha256!==manifest.provenance.migrationsSha256)throw Error('BUNDLE_MIGRATION_PROVENANCE_MISMATCH');
 let t=await target(env,bundle,action);
 let backupSha256;if(action==='upgrade')backupSha256=await verifiedBackup(env,t);
 const run=docker??(async args=>{try{return execFileSync('docker',args,{encoding:'utf8',maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']});}catch(error){
  // Local private diagnostics can contain operational details; never echo them to CLI output.
  try{await writeFile(path.join(t.runtime,'.nipt-last-command-error.log'),JSON.stringify({command:args[0],stdout:error.stdout?.toString(),stderr:error.stderr?.toString()}),{mode:0o600});}catch{}
  throw error;
 }});
 let appOverride=t.state?.appOverride;
 const compose=(...args)=>run(['compose','--project-directory',t.runtime,'--project-name',t.project,'--env-file',path.join(t.runtime,'.nipt-compose.env'),'--file',path.join(t.runtime,'compose.yaml'),...(appOverride?['--file',appOverride]:[]),...args]);
 await run(['info']);
 if(action==='preflight')return {status:'MEDIA_VERIFIED',revision:manifest.provenance.revision};
 if(action==='install'){
  for(const args of [['ps','-aq','--filter',`label=com.docker.compose.project=${t.project}`],['volume','ls','-q','--filter',`label=com.docker.compose.project=${t.project}`]])if(String(await run(args)).trim())throw Error('COMPOSE_PROJECT_ALREADY_OCCUPIED');
 }
 for(const file of (await readdir(path.join(bundle,'images'))).sort()){if(!/^[a-zA-Z0-9_.-]+\.tar$/.test(file))throw Error('IMAGE_ARCHIVE_INVALID');await run(['load','--input',path.join(bundle,'images',file)]);}
 for(const role of roles){const [image]=JSON.parse(await run(['image','inspect',ids[role]]));if(image?.Id!==ids[role])throw Error('LOADED_IMAGE_MISMATCH');assertImageProvenance(image,role,manifest);}
 let phase='PREPARE';
 let lockHeld=false,mutationStarted=false;
 const record={syntheticOnly:true,runtimeRoot:t.runtime,project:t.project,port:t.port,revision:manifest.provenance.revision,images:ids,version:manifest.version,status:'STARTED_NOT_ACCEPTED',backupSha256};
 try{
  if(action==='install'){
   await mkdir(path.dirname(t.runtime),{recursive:true});await mkdir(t.runtime);await mkdir(path.join(t.runtime,'data'));
  }
  await writeFile(path.join(t.runtime,'.nipt-deploy.lock'),JSON.stringify({action,revision:record.revision}),{flag:'wx',mode:0o600});lockHeld=true;
  if(action!=='install'){
   // Image loading can take minutes. Earlier marker/backup observations are not mutation authority.
   const current=await target(env,bundle,action);
   if(action==='upgrade')record.backupSha256=await verifiedBackup(env,current);
   if(current.markerSnapshot!==t.markerSnapshot)throw Error('RUNTIME_CHANGED_BEFORE_DEPLOYMENT_LOCK');
   t=current;appOverride=t.state?.appOverride;
  }else{
   for(const args of [['ps','-aq','--filter',`label=com.docker.compose.project=${t.project}`],['volume','ls','-q','--filter',`label=com.docker.compose.project=${t.project}`]])if(String(await run(args)).trim())throw Error('COMPOSE_PROJECT_ALREADY_OCCUPIED');
  }
  mutationStarted=true;
  if(action==='install'){
   await run(['run','--rm','--network','none','--user','0:0','--volume',`${t.runtime}:/runtime`,'--workdir','/runtime',ids.operations,'sh','-c','node --import /app/node_modules/tsx/dist/loader.mjs /app/tools/init-dev.ts && chown -R 1000:1000 data && find data -type d -exec chmod 750 {} + && find data -type f -exec chmod 440 {} +']);
  }else{
   phase='DRAIN';await compose('stop','--timeout','60','web','simulator');await compose('stop','--timeout','60','worker');
   const worker=String(await compose('ps','--all','--quiet','worker')).trim();if(!worker)throw Error('DRAIN_WORKER_EVIDENCE_MISSING');
   const [stopped]=JSON.parse(await run(['inspect',worker]));if(stopped?.State?.Running!==false||stopped?.State?.ExitCode!==0)throw Error('WORKER_DRAIN_NOT_CLEAN');
  }
  phase='CONFIGURE';await mkdir(path.join(t.runtime,'deploy'),{recursive:true});
  if(action==='rollback'){
   // Preserve current database/migrator/service topology. Only compatible app IDs change.
   // operations is shared by worker/migrator: use a service-only override.
   const override=path.join(t.runtime,'rollback-apps.json');await writeFile(override,JSON.stringify({services:{web:{image:ids.web},worker:{image:ids.operations},renderer:{image:ids.renderer}}},null,2));
   appOverride=override;await compose('config','--quiet');phase='ROLLBACK_START';await compose('up','-d','--pull','never','--no-build','--no-deps','--force-recreate','renderer','web','worker');
   // Make app override persistent for subsequent operational commands without rewriting SQL topology.
   record.appOverride=override;record.images={...t.state.images,web:ids.web,operations:ids.operations,renderer:ids.renderer};
   record.schemaRevision=t.failedState?.schemaStatus==='REVIEW_REQUIRED_AFTER_ATTEMPT'?null:t.state.schemaRevision??t.state.revision;
   record.schemaStatus=t.failedState?.schemaStatus??t.state.schemaStatus??'UNCHANGED_BY_APP_ROLLBACK';record.compatibilityReviewed=true;
  }else{
   appOverride=undefined;await copyFile(path.join(bundle,'compose.yaml'),path.join(t.runtime,'compose.yaml'));await copyFile(path.join(bundle,'deploy/Caddyfile'),path.join(t.runtime,'deploy/Caddyfile'));
   await writeFile(path.join(t.runtime,'.nipt-compose.env'),`NIPT_HTTPS_PORT=${t.port}\n`,{mode:0o600});
   await compose('config','--quiet');
   phase='DATABASE';await compose('up','-d','--pull','never','--no-build','--wait','db');
   await compose('run','--rm','--no-deps','--pull','never','storage-init');
   phase='MIGRATE';await compose('run','--rm','--no-deps','--pull','never','migrate');
   await compose('run','--rm','--no-deps','--pull','never','simulator');
   phase='START';await compose('up','-d','--pull','never','--no-build','--no-deps','renderer');await compose('up','-d','--pull','never','--no-build','--no-deps','web','worker','proxy');
  }
  await writeFile(path.join(t.runtime,marker),JSON.stringify(record,null,2));
  return record;
 }catch(error){
  if(lockHeld&&mutationStarted)await writeFile(path.join(t.runtime,marker),JSON.stringify({...t.state,syntheticOnly:true,runtimeRoot:t.runtime,project:t.project,port:t.port,status:'FAILED',phase,attemptedRevision:record.revision,lastStartedState:t.state??undefined,schemaStatus:['MIGRATE','START'].includes(phase)?'REVIEW_REQUIRED_AFTER_ATTEMPT':t.failedState?.schemaStatus??t.state?.schemaStatus??'NO_SUCCESSFUL_INSTALL'},null,2));
  throw error;
 }finally{if(lockHeld)await unlink(path.join(t.runtime,'.nipt-deploy.lock'));}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const result=await deploy(process.argv[2]);process.stdout.write(JSON.stringify({status:result.status,revision:result.revision??null})+'\n');}
 catch(e){process.stderr.write((/^[A-Z0-9_]+$/.test(e.message)?e.message:'DEPLOYMENT_FAILED_RETAIN_RUNTIME_LOGS')+'\n');process.exitCode=1;}
}
