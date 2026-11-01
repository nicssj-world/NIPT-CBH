import {spawn,execFileSync} from 'node:child_process';
import {openSync,closeSync} from 'node:fs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import https from 'node:https';
import {X509Certificate,createHash} from 'node:crypto';
import {Client} from 'pg';
import {sourceInventory} from '../source-inventory.mjs';
export const runtimeBase=path.resolve('.local/migration-runtime');
export const runtimePorts={web:20367,https:20368,db:20369,renderer:20370};
export const runtimeDatabase='nipt_migration_development';
export async function developmentEnvironment(role:'owner'|'web'|'worker'|'renderer'='owner'){
 const secret=async(n:string)=>(await readFile(path.join(runtimeBase,'private',n),'utf8')).trim();
 const user=role==='web'||role==='renderer'?'nipt_migration_web':role==='worker'?'nipt_migration_worker':'nipt_migration_owner',password=await secret(role==='web'||role==='renderer'?'web-password':role==='worker'?'worker-password':'db-password');
 return {...process.env,NIPT_MODE:'operational',NIPT_OPERATIONAL_DATABASE:runtimeDatabase,DATABASE_URL:`postgresql://${user}:${encodeURIComponent(password)}@127.0.0.1:${runtimePorts.db}/${runtimeDatabase}`,APP_ORIGIN:`https://127.0.0.1:${runtimePorts.https}`,HOSTNAME:'127.0.0.1',PORT:String(runtimePorts.web),NEXT_TELEMETRY_DISABLED:'1',NIPT_LOCAL_UAT_BANNER:'1',
 FILE_STORE_ROOT:path.join(runtimeBase,'files'),SIMULATOR_ROOT:path.join(runtimeBase,'simulator'),RENDERER_URL:`http://127.0.0.1:${runtimePorts.renderer}`,RENDERER_HOST:'127.0.0.1',RENDERER_PORT:String(runtimePorts.renderer),RENDERER_TOKEN_FILE:path.join(runtimeBase,'keys/renderer-token'),
 INTEGRATION_PUBLIC_KEY_FILE:path.join(runtimeBase,'keys/integration-public.pem'),INTEGRATION_PRIVATE_KEY_FILE:path.join(runtimeBase,'keys/integration-private.pem'),IDENTITY_ENCRYPTION_KEY_FILE:path.join(runtimeBase,'keys/identity.key'),IDENTITY_LOOKUP_KEY_FILE:path.join(runtimeBase,'keys/lookup.key'),BACKUP_KEY_FILE:path.join(runtimeBase,'keys/backup.key'),
 NIPT_HIS_SHARE_POLICY_FILE:path.join(runtimeBase,'share-policy.json'),NIPT_TASK_MASTER_PATH:path.join(runtimeBase,'approved/master.xlsx'),NIPT_POOL_CSV_TEMPLATE:path.join(runtimeBase,'approved/pooling.csv'),NIPT_NIFTY_XLSX_TEMPLATE:path.join(runtimeBase,'approved/nifty.xlsx'),NIPT_HALOS_TASK_TEMPLATE:path.join(runtimeBase,'approved/halos-task.xlsx'),NIPT_REPORT_TEMPLATE_SINGLETON:path.join(runtimeBase,'approved/singleton.docx'),NIPT_REPORT_TEMPLATE_TWIN:path.join(runtimeBase,'approved/twin.docx'),
 NIPT_OPERATIONS_STATUS_FILE:path.join(runtimeBase,'operations-status.json'),NIPT_OPERATIONS_STATUS_PUBLIC_KEY_FILE:path.join(runtimeBase,'keys/operations-public.pem'),NIPT_BACKUP_POLICY_FILE:path.join(runtimeBase,'backup-policy.json'),PG_BIN:path.resolve('..','..','.local/p8-win/setup-packages/nipt-cbh-1.0.2-pwsh-7.6.7-preserved/payload/runtime/pg/bin')};
}
async function runService(name:string){const role=name==='worker'?'worker':name==='renderer'?'renderer':'web';Object.assign(process.env,await developmentEnvironment(role));
 if(name==='web'){const next=await import('next');const app=next.default({webpack:true,dev:process.env.NIPT_MIGRATION_WEB_DEV==='yes',dir:process.cwd(),hostname:'127.0.0.1',port:runtimePorts.web});await app.prepare();const{createServer}=await import('node:http');createServer((req,res)=>void app.getRequestHandler()(req,res)).listen(runtimePorts.web,'127.0.0.1');}
 else if(name==='worker'){const{startWorker}=await import('../../packages/jobs/worker');await startWorker();}
 else if(name==='renderer'){const{startRenderer}=await import('../../apps/renderer/main');await startRenderer();}
 else if(name==='tls'){process.argv=[process.execPath,'tools/task3-uat/tls-proxy.mjs',path.join(runtimeBase,'tls/development-private.pfx'),path.join(runtimeBase,'private/tls-passphrase'),String(runtimePorts.https),String(runtimePorts.web)];const proxy='../task3-uat/tls-proxy.mjs';await import(proxy);}
 else throw Error('DEVELOPMENT_SERVICE_INVALID');
}
async function start(names=['renderer','web','tls','worker']){await mkdir(path.join(runtimeBase,'logs'),{recursive:true});const pids:Record<string,number>=names.length===1?JSON.parse(await readFile(path.join(runtimeBase,'runtime.json'),'utf8')).pids:{};for(const name of names){const log=openSync(path.join(runtimeBase,'logs',name+'.log'),'a');const child=spawn(process.execPath,['--import','tsx','tools/migration/runtime-launch.ts',name],{cwd:process.cwd(),env:await developmentEnvironment(name==='worker'?'worker':name==='renderer'?'renderer':'web'),detached:true,windowsHide:true,stdio:['ignore',log,log]});closeSync(log);child.unref();if(!child.pid)throw Error('DEVELOPMENT_START_FAILED');pids[name]=child.pid;}
 const runtime={format:'NIPT_MIGRATION_DEVELOPMENT_V1',url:`https://127.0.0.1:${runtimePorts.https}/login`,database:runtimeDatabase,ports:runtimePorts,pids,sourceRoot:process.cwd(),gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim(),buildId:await readFile('.next/BUILD_ID','utf8').then(v=>v.trim()).catch(()=>'DEVELOPMENT_UNBUILT'),startedAt:new Date().toISOString(),accountsFile:path.join(runtimeBase,'private/development-accounts.json'),developmentMode:process.env.NIPT_MIGRATION_WEB_DEV==='yes',productionAcceptance:false};await writeFile(path.join(runtimeBase,'runtime.json'),JSON.stringify(runtime,null,2));process.stdout.write(JSON.stringify({url:runtime.url,buildId:runtime.buildId,pids})+'\n');}
async function refreshDevelopmentBackup(){
 const env={...await developmentEnvironment('owner'),BACKUP_SOURCE_QUIESCENT:'yes',NIPT_OPERATIONS_STATUS_SIGNING_KEY_FILE:path.join(runtimeBase,'keys/operations-private.pem')};
 const {operationalBackup}=await import('../../deploy/scripts/operational-backup.mjs');const{publishOperationsStatus}=await import('../../deploy/scripts/operations-status.mjs');
 const receipt=await operationalBackup(path.join(runtimeBase,'backups'),env);const published=await publishOperationsStatus('backup',receipt,env);if(published.status!=='PUBLISHED')throw Error('DEVELOPMENT_BACKUP_RECEIPT_NOT_VERIFIED');await writeFile(path.join(runtimeBase,'backup-latest.json'),JSON.stringify(receipt,null,2));process.stdout.write(JSON.stringify({status:'VERIFIED_DEVELOPMENT_BACKUP',manifestSha256:receipt.manifestSha256,backupBase:receipt.backupBase})+'\n');
}
async function verifyRuntime(){
 const prior=JSON.parse(await readFile(path.join(runtimeBase,'runtime.json'),'utf8'));
 const cert=await readFile(path.join(runtimeBase,'tls/development.cer')),ca=new X509Certificate(cert).toString();
 const status=await new Promise<{status:number;body:string}>((resolve,reject)=>{https.get(`https://127.0.0.1:${runtimePorts.https}/api/health`,{ca},r=>{let body='';r.on('data',b=>body+=b);r.on('end',()=>resolve({status:r.statusCode??0,body}));}).on('error',reject);});
 const renderer=await fetch(`http://127.0.0.1:${runtimePorts.renderer}/health`,{headers:{authorization:'Bearer '+(await readFile(path.join(runtimeBase,'keys/renderer-token'),'utf8')).trim()}});
 const env=await developmentEnvironment('owner'),db=new Client({connectionString:env.DATABASE_URL});await db.connect();let evidence;try{evidence={migrations:(await db.query('SELECT name,checksum FROM schema_migration ORDER BY name')).rows,worker:(await db.query('SELECT worker_id,observed_at,details FROM worker_heartbeat')).rows,counts:(await db.query('SELECT (SELECT count(*) FROM nipt_case)::int cases,(SELECT count(*) FROM migration_record)::int migration_records,(SELECT count(*) FROM p6_transfer)::int his_transfers,(SELECT count(*) FROM result_release)::int releases')).rows[0]};}finally{await db.end();}
 const inventory=await sourceInventory(process.cwd());const runtime={...prior,developmentMode:prior.developmentMode??prior.buildId==='DEVELOPMENT_UNBUILT',verifiedAt:new Date().toISOString(),verification:{tlsPinnedHealth:status,rendererStatus:renderer.status,database:evidence,sourceAtVerificationSha256:inventory.sha256,sourceAtVerificationFiles:inventory.rawFiles,tlsCertificateSha256:createHash('sha256').update(cert).digest('hex')}};
 await writeFile(path.join(runtimeBase,'runtime.json'),JSON.stringify(runtime,null,2));process.stdout.write(JSON.stringify({url:runtime.url,developmentMode:runtime.developmentMode,healthStatus:status.status,rendererStatus:renderer.status,worker:evidence.worker,counts:evidence.counts,sourceAtVerificationSha256:inventory.sha256,tlsCertificateSha256:runtime.verification.tlsCertificateSha256})+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const command=process.argv[2];(command==='start'?start():command==='start-web'?start(['web']):command==='verify'?verifyRuntime():command==='backup'?refreshDevelopmentBackup():command==='start-worker'?start(['worker']):runService(command)).catch(e=>{process.stderr.write('MIGRATION_DEVELOPMENT_RUNTIME_FAILED '+(e instanceof Error?e.message:'UNKNOWN')+'\n');process.exitCode=1;});}








