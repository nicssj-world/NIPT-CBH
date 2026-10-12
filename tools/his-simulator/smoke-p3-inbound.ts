// P3 native smoke (synthetic only, disposable test DB): true concurrency for AT-LDR-08 under real least-privilege
// logins (web=app_rw registration+link, worker=worker_rw matching), then the real pg-boss worker end to end.
import {readFile,mkdtemp,mkdir,writeFile,rm,rename} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomInt,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {assertSyntheticDatabase} from '../../packages/db/connection';
import {FileStore} from '../../packages/storage';
import {registerCase} from '../../packages/db/registration';
import {proposeSetting,validateSetting,approveSetting,activateSetting} from '../../packages/settings/service';
import {SETTINGS} from '../../packages/settings/catalog';
import {buildSyntheticPet} from '../../packages/inbound/wire';
import {lnHnKey} from '../../packages/inbound/identity';
import {discoverInbound} from '../../packages/inbound/discovery';
import {processInboundFile,processPending} from '../../packages/inbound/process';
import {linkIntakeAtRegistration} from '../../packages/inbound/registration-link';
import {transactional} from '../../packages/inbound/tx';
import type {Principal} from '../../packages/security/policy';

const superUrl=process.env.DATABASE_URL!;assertSyntheticDatabase(superUrl);
const login=async(user:string,file:string)=>{const u=new URL(superUrl);u.username=user;u.password=(await readFile(file,'utf8')).trim();return u.toString();};
const admin=new Pool({connectionString:superUrl}),web=new Pool({connectionString:await login('nipt_web',process.env.WEB_DB_PASSWORD_FILE??'data/secrets/web-password'),max:10}),workerUrl=await login('nipt_worker',process.env.WORKER_DB_PASSWORD_FILE??'data/secrets/worker-password'),worker=new Pool({connectionString:workerUrl,max:10});
const key=await readFile(process.env.IDENTITY_LOOKUP_KEY_FILE!),tmp=await mkdtemp(path.join(os.tmpdir(),'nipt-p3-native-')),root=path.join(tmp,'simulator'),store=new FileStore(path.join(tmp,'files')),deps={store,lookupKey:key};
const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Bangkok'}).replace(/-/g,''),HN='9900001001',run=String(randomInt(100000,999999));
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const writePet=async(ln:string,hn:string)=>{const p=buildSyntheticPet({ln,hn,receivedAt:today+'090000'}),dir=path.join(root,'inbound',today);await mkdir(dir,{recursive:true});await writeFile(path.join(dir,p.filename),p.bytes);await writeFile(path.join(dir,p.filename.replace('.pet','.ok')),'');};
const result:Record<string,unknown>={code:'NATIVE_P3_INBOUND_SMOKE_PASSED'};
let stopWorker:(()=>Promise<void>)|undefined;
try{
 await mkdir(path.join(root,'inbound'),{recursive:true});await writeFile(path.join(root,'.nipt-synthetic-root'),'NIPT_SYNTHETIC_ONLY_V1');
 // Phase 1 — AT-LDR-08: registration (web) and worker apply race on the same LN, plus a replay and an aborted attempt.
 const N=12,lns=Array.from({length:N},(_,i)=>`99000${run}${String(i).padStart(2,'0')}`);
 for(const [i,ln] of lns.entries())if(i%3!==2)await writePet(ln,HN); // i%3==2: registration first, PET later
 await discoverInbound(worker,store,{root,lookbackDays:1,lookupKey:key});
 const fileId=async(ln:string)=>(await admin.query<{id:string}>('SELECT id FROM his_inbound_file WHERE ln=$1',[ln])).rows[0]?.id;
 await Promise.all(lns.map(async(ln,i)=>{
  const hn=i%2===0?HN:'9900006666',idem=`p3_native_${run}_${i}`,tx=transactional(web);
  const register=(abort:boolean)=>tx(async c=>{await sleep(randomInt(0,15));const r=await registerCase(c,{ln,identityKey:lnHnKey(ln,hn,key),origin:'LAB_DIRECT',idempotencyKey:idem});await linkIntakeAtRegistration(c,{caseId:r.caseId,ln,hn,identifierSource:'TUBE_LABEL'},deps);if(abort)throw Error('SIMULATED_ABORT');}).catch(e=>{if(!(abort&&e.message==='SIMULATED_ABORT'))throw e;});
  const id=await fileId(ln);
  await Promise.all([register(true),register(false),register(false),...(id?[transactional(worker)(async c=>{await sleep(randomInt(0,15));return processInboundFile(c,id,deps);})]:[])]);
 }));
 for(const [i,ln] of lns.entries())if(i%3===2)await writePet(ln,HN);
 await discoverInbound(worker,store,{root,lookbackDays:1,lookupKey:key});await processPending(worker,deps);
 for(const [i,ln] of lns.entries()){
  const s=(await admin.query<{cases:number;lns:number;orders:number;attempts:number;round:string;file:string;issues:string}>(`SELECT (SELECT count(DISTINCT case_id)::int FROM case_ln WHERE ln=$1) AS cases,(SELECT count(*)::int FROM case_ln WHERE ln=$1) AS lns,
   (SELECT count(*)::int FROM his_order o JOIN case_ln l ON l.id=o.case_ln_id WHERE l.ln=$1) AS orders,(SELECT count(*)::int FROM registration_attempt WHERE idempotency_key=$2) AS attempts,
   (SELECT r.state FROM specimen_round r JOIN case_ln l ON l.id=r.case_ln_id WHERE l.ln=$1) AS round,(SELECT string_agg(state,',') FROM his_inbound_file WHERE ln=$1) AS file,
   (SELECT coalesce(string_agg(kind,',' ORDER BY kind),'') FROM his_intake_issue WHERE ln=$1 AND state IN ('Open','Proposed')) AS issues`,[ln,`p3_native_${run}_${i}`])).rows[0];
  const expected=i%2===0?{cases:1,lns:1,orders:1,attempts:1,round:'ReceivedInHIS',file:'Applied(S1)',issues:''}:{cases:1,lns:1,orders:0,attempts:1,round:'Expected',file:'Unlinked',issues:'IDENTITY_MISMATCH'};
  if(JSON.stringify(s)!==JSON.stringify(expected))throw Error(`LDR08_INVARIANT_${i}:${JSON.stringify(s)}`);
 }
 result.concurrentLns=N;result.ldr08Invariant=true;
 // Phase 2 — real worker (worker_rw login, pg-boss) runs a manual scan and Test Connection; share outage is visible.
 const users=(await admin.query<{id:string;username:string}>("SELECT id,username FROM app_user WHERE username IN ('synthetic.admin','synthetic.approver')")).rows;
 const adminUser:Principal={id:users.find(u=>u.username==='synthetic.admin')!.id,roles:['APP_ADMIN'],unitIds:[],permissions:[]},approver:Principal={id:users.find(u=>u.username==='synthetic.approver')!.id,roles:['CLINICAL_APPROVER'],unitIds:[],permissions:[]};
 const setInbound=async(enabled:boolean)=>{const c=await admin.connect();try{await c.query('BEGIN');const id=await proposeSetting(c,adminUser,'his_inbound',{...SETTINGS.his_inbound.default,enabled,intervalSeconds:3600,lookbackDays:2},'SYNTHETIC P3 native smoke');await validateSetting(c,adminUser,id,async()=>true);await approveSetting(c,approver,id);await activateSetting(c,approver,id);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
 await setInbound(true);
 process.env.SIMULATOR_ROOT=root;process.env.FILE_STORE_ROOT=path.join(tmp,'files');process.env.DATABASE_URL=workerUrl;
 const {startWorker}=await import('../../packages/jobs/worker');
 const w=await startWorker();stopWorker=w.stop;
 const ln=`99000${run}99`;await transactional(web)(c=>registerCase(c,{ln,identityKey:lnHnKey(ln,HN,key),origin:'ANC',idempotencyKey:`p3_native_${run}_worker`}));await writePet(ln,HN);
 const job=async(kind:string,payload:unknown)=>{const id=(await admin.query<{id:string}>('INSERT INTO job_outbox(kind,payload,idempotency_key) VALUES($1,$2,$3) RETURNING id',[kind,JSON.stringify(payload),`p3-native-${randomUUID()}`])).rows[0].id;await w.cycle();for(let i=0;i<150;i++){const r=(await admin.query<{result:Record<string,unknown>}>('SELECT result FROM integration_job_receipt WHERE outbox_id=$1',[id])).rows[0];if(r)return r.result;await sleep(200);}throw Error('JOB_RECEIPT_MISSING_'+kind);};
 const scan=await job('synthetic_scan',{trigger:'MANUAL'});
 if(scan.outcome!=='SUCCESS'||(await admin.query("SELECT r.state FROM specimen_round r JOIN case_ln l ON l.id=r.case_ln_id WHERE l.ln=$1",[ln])).rows[0].state!=='ReceivedInHIS')throw Error('WORKER_SCAN_NOT_APPLIED');
 const test=await job('synthetic_inbound_test',{});if(test.passed!==true)throw Error('CONNECTION_TEST_FAILED');
 await rename(path.join(root,'.nipt-synthetic-root'),path.join(root,'.offline'));
 const outageJob=(await admin.query<{id:string}>("INSERT INTO job_outbox(kind,payload,idempotency_key) VALUES('synthetic_scan',$1,$2) RETURNING id",[JSON.stringify({trigger:'MANUAL'}),`p3-native-${randomUUID()}`])).rows[0].id;await w.cycle();
 let outage=false;for(let i=0;i<100&&!outage;i++){outage=(await admin.query("SELECT 1 FROM his_inbound_scan_run WHERE outcome='SHARE_UNAVAILABLE' AND finished_at>now()-interval '2 minutes'")).rows.length>0&&(await admin.query("SELECT details FROM worker_heartbeat WHERE worker_id='synthetic-worker'")).rows[0]?.details.lastError==='INBOUND_SHARE_UNAVAILABLE';if(!outage)await sleep(200);}
 if(!outage)throw Error('SHARE_OUTAGE_NOT_VISIBLE');
 await rename(path.join(root,'.offline'),path.join(root,'.nipt-synthetic-root'));
 await admin.query("UPDATE job_outbox SET state='Cancelled',cancel_epoch=cancel_epoch+1 WHERE id=$1",[outageJob]);
 Object.assign(result,{workerScanApplied:true,workerRole:'nipt_worker',connectionTestPassed:true,shareOutageVisible:true});
}finally{
 await stopWorker?.().catch(()=>undefined);
 try{
  const users=(await admin.query<{id:string;username:string}>("SELECT id,username FROM app_user WHERE username IN ('synthetic.admin','synthetic.approver')")).rows;
  const a:Principal={id:users.find(u=>u.username==='synthetic.admin')!.id,roles:['APP_ADMIN'],unitIds:[],permissions:[]},b:Principal={id:users.find(u=>u.username==='synthetic.approver')!.id,roles:['CLINICAL_APPROVER'],unitIds:[],permissions:[]};
  const c=await admin.connect();try{await c.query('BEGIN');const id=await proposeSetting(c,a,'his_inbound',{...SETTINGS.his_inbound.default,enabled:false},'SYNTHETIC P3 smoke restore');await validateSetting(c,a,id,async()=>true);await approveSetting(c,b,id);await activateSetting(c,b,id);await c.query('COMMIT');}catch{await c.query('ROLLBACK');}finally{c.release();}
 }finally{
  const {pool}=await import('../../packages/db/connection');await pool().end().catch(()=>undefined);
  await Promise.all([admin.end(),web.end(),worker.end()]);key.fill(0);await rm(tmp,{recursive:true,force:true});
 }
}
console.log(JSON.stringify(result));
