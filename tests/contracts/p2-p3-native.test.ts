import {it,expect} from 'vitest';
import {Client} from 'pg';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,randomInt} from 'node:crypto';
import {migrate} from '../../tools/migrate';
import {assertSyntheticDatabase} from '../../packages/db/connection';
import {hashPassword} from '../../packages/security/password';
import {digest} from '../../packages/security/session';
import {FileStore} from '../../packages/storage';
import {buildSyntheticPet} from '../../packages/inbound/wire';
import {discoverInbound} from '../../packages/inbound/discovery';
import {processInboundFile} from '../../packages/inbound/process';
import {registerP2,saveRequest,lockRequest,doctorAction,prepareConsent,startSigning,type Staff} from '../../packages/p2/service';
import {emptyRequest} from '../../packages/p2/schema';

// Explicitly opt-in; never uses DATABASE_URL/Production. Disposable native DB only; real app_rw and worker_rw sessions.
it.skipIf(!process.env.NIPT_TEST_DATABASE_URL)('native P2-P3: registration vs PET races for ANC and LAB_DIRECT, and P2 case/signing locks vs worker S1 apply in both orders',async()=>{
 const url=process.env.NIPT_TEST_DATABASE_URL!;assertSyntheticDatabase(url);
 const owner=new Client({connectionString:url}),apps=[new Client({connectionString:url}),new Client({connectionString:url})],worker=new Client({connectionString:url});
 const tmp=await mkdtemp(path.join(os.tmpdir(),'nipt-p2p3-native-')),root=path.join(tmp,'simulator'),store=new FileStore(path.join(tmp,'files')),key=randomBytes(32),deps={store,lookupKey:key};
 try{
  await owner.connect();await migrate(owner);await owner.query(await readFile('packages/db/roles.sql','utf8'));await owner.query('GRANT SELECT,INSERT ON file_asset,case_event TO worker_rw');
  for(const c of apps){await c.connect();await c.query('SET ROLE app_rw');}await worker.connect();await worker.query('SET ROLE worker_rw');
  await mkdir(path.join(root,'inbound'),{recursive:true});await writeFile(path.join(root,'.nipt-synthetic-root'),'NIPT_SYNTHETIC_ONLY_V1');
  const run=String(randomInt(100000,999999)),hash=await hashPassword('SYNTHETIC-NATIVE-PASSWORD-48!'),HN='9900001001',today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Bangkok'}).replace(/-/g,'');
  const unit=(await owner.query<{id:string}>("INSERT INTO unit(code,name) VALUES($1,'จำลอง') RETURNING id",['SYNTHETIC_P2P3_'+run])).rows[0].id;
  const user=async(name:string,role:Staff['roles'][number],scoped:boolean):Promise<Staff>=>({id:(await owner.query<{id:string}>("INSERT INTO app_user(username,display_name,password_hash) VALUES($1,'จำลอง',$2) RETURNING id",[`synthetic.p2p3.${name}.${run}`,hash])).rows[0].id,roles:[role],unitIds:scoped?[unit]:[],permissions:[]});
  const anc=await user('anc','ANC_NURSE',true),lab=await user('lab','LAB_STAFF',false),admin=await user('admin','APP_ADMIN',false),checker=await user('checker','CLINICAL_APPROVER',false);
  const tx=async<T>(client:Client,fn:()=>Promise<T>,holdMs=0)=>{await client.query('BEGIN');try{const r=await fn();if(holdMs)await client.query('SELECT pg_sleep($1)',[holdMs/1000]);await client.query('COMMIT');return r;}catch(e){await client.query('ROLLBACK');throw e;}};
  const pet=async(ln:string,hn:string,specimenAt=today+'070000')=>{const p=buildSyntheticPet({ln,hn,receivedAt:today+'090000',specimenAt}),dir=path.join(root,'inbound',today);await mkdir(dir,{recursive:true});await writeFile(path.join(dir,p.filename),p.bytes);await writeFile(path.join(dir,p.filename.replace('.pet','.ok')),'');await discoverInbound(worker,store,{root,lookbackDays:1,lookupKey:key});return (await owner.query<{id:string}>('SELECT id FROM his_inbound_file WHERE ln=$1',[ln])).rows[0].id;};
  const register=(client:Client,ln:string,hn:string,origin:'ANC'|'LAB_DIRECT',idempotencyKey:string)=>tx(client,async()=>{await new Promise(r=>setTimeout(r,randomInt(0,20)));return registerP2(client,origin==='ANC'?anc:lab,{ln,hn,unitId:unit,origin,idempotencyKey,...(origin==='LAB_DIRECT'?{identifierSource:'TUBE_LABEL'}:{})},key,{store});});
  const state=async(ln:string)=>(await owner.query(`SELECT (SELECT count(*)::int FROM case_ln WHERE ln=$1) AS cases,(SELECT count(*)::int FROM his_order o JOIN case_ln l ON l.id=o.case_ln_id WHERE l.ln=$1) AS orders,
   (SELECT r.state FROM specimen_round r JOIN case_ln l ON l.id=r.case_ln_id WHERE l.ln=$1) AS round,(SELECT string_agg(state,',') FROM his_inbound_file WHERE ln=$1) AS file,
   (SELECT coalesce(string_agg(kind,',' ORDER BY kind),'') FROM his_intake_issue WHERE ln=$1 AND state IN ('Open','Proposed')) AS issues`,[ln])).rows[0];

  // 1. AT-LDR-08 for both origins: Ready PET and registration (two same-key web transactions) race on separate sessions.
  const cases=Array.from({length:8},(_,i)=>({ln:`99000${run}${String(i).padStart(2,'0')}`,origin:(i%2?'LAB_DIRECT':'ANC') as 'ANC'|'LAB_DIRECT',hn:i%4<2?HN:'9900006666'}));
  for(const c of cases){
   const file=await pet(c.ln,HN),idem=`p2p3_native_${c.ln}`;
   const outcomes=await Promise.allSettled([register(apps[0],c.ln,c.hn,c.origin,idem),register(apps[1],c.ln,c.hn,c.origin,idem),tx(worker,async()=>{await new Promise(r=>setTimeout(r,randomInt(0,20)));return processInboundFile(worker,file,deps);})]);
   expect(outcomes.filter(o=>o.status==='rejected')).toEqual([]);
   const regs=outcomes.slice(0,2).map(o=>(o as PromiseFulfilledResult<{caseId:string|null;outcome:string}>).value);
   expect(regs[0].caseId).toBe(regs[1].caseId);expect(regs.map(r=>r.outcome)).toEqual(['CREATED','CREATED']);
   expect(await state(c.ln)).toEqual(c.hn===HN?{cases:1,orders:1,round:'ReceivedInHIS',file:'Applied(S1)',issues:''}:{cases:1,orders:0,round:'Expected',file:'Unlinked',issues:'IDENTITY_MISMATCH'});
   expect((await owner.query('SELECT count(*)::int AS n FROM registration_attempt WHERE idempotency_key=$1',[idem])).rows[0].n).toBe(1);
  }

  // 2. P2 case lock (autosave, then case-before-signing) held across a worker S1 apply, in both acquisition orders.
  const doctor=await tx(apps[0],()=>doctorAction(apps[0],admin,{action:'propose',doctorKey:'SYNTHETIC-P2P3-'+run,name:'SYNTHETIC native doctor',unitId:unit,effectiveFrom:'2020-01-01T00:00:00Z',authorization:'SYNTHETIC authority',vector:{width:600,height:200,strokes:[[[10,10],[80,90]]]}}));
  await tx(apps[0],()=>doctorAction(apps[0],checker,{action:'approve',id:doctor.id,reason:'SYNTHETIC checked'}));
  const draft=structuredClone(emptyRequest);draft.patient.syntheticName='SYNTHETIC native patient';Object.assign(draft.pregnancy,{type:'Singleton',edd:'2027-01-01',collectionDate:'2026-08-01',collectionSource:'ANC',weightKg:60,heightCm:160,vanishingTwin:'No',fetalSex:'DoNotWant',sca:'DoNotWant'});
  for(const k of ['transfusion4months','heparin24h','immune1month','albumin4weeks','exogenousDna4weeks'] as const)draft.history[k].answer='No';Object.assign(draft.history,{cancerTreatment:'No',gaUnder8:'No',tumor:'No',priorChromosomeTest:'No',otherHistory:'No'});draft.ordering.doctorVersionId=String(doctor.id);
  for(const [i,order] of (['p2-first','worker-first','p2-first','worker-first'] as const).entries()){
   const ln=`99000${run}9${i}`,id=(await register(apps[0],ln,HN,'ANC',`p2p3_lock_${ln}`)).caseId!,file=await pet(ln,HN);
   const signing=i>=2;let p2:()=>Promise<unknown>;
   if(signing){
    await tx(apps[0],()=>saveRequest(apps[0],anc,id,{expectedVersion:0,draft}));await tx(apps[0],()=>lockRequest(apps[0],anc,id,{expectedVersion:1,reason:'SYNTHETIC locked'}));
    const consent=await tx(apps[0],()=>prepareConsent(apps[0],anc,id,{doctorVersionId:String(doctor.id),representativeRequired:false,reason:'SYNTHETIC prepared'}));
    const session=(await owner.query<{id:string}>("INSERT INTO app_session(user_id,token_hash,csrf_hash,idle_expires_at,absolute_expires_at) VALUES($1,$2,$3,now()+interval '30 minutes',now()+interval '8 hours') RETURNING id",[anc.id,digest(crypto.randomUUID()),digest(crypto.randomUUID())])).rows[0].id;
    p2=()=>startSigning(apps[1],{...anc,sessionId:session},id,{documentId:consent.id,devicePresent:true,syntheticPatient:true});
   }else p2=()=>saveRequest(apps[1],anc,id,{expectedVersion:0,draft});
   const p2Tx=()=>tx(apps[1],p2,order==='p2-first'?400:0),workerTx=()=>tx(worker,()=>processInboundFile(worker,file,deps),order==='worker-first'?400:0);
   const delayed=<T>(fn:()=>Promise<T>)=>new Promise<T>((resolve,reject)=>setTimeout(()=>fn().then(resolve,reject),100));
   const settled=await Promise.allSettled(order==='p2-first'?[p2Tx(),delayed(workerTx)]:[delayed(p2Tx),workerTx()]);
   expect(settled.filter(s=>s.status==='rejected').map(s=>String((s as PromiseRejectedResult).reason))).toEqual([]);
   expect(await state(ln)).toEqual({cases:1,orders:1,round:'ReceivedInHIS',file:'Applied(S1)',issues:''});
   if(signing)expect((await owner.query("SELECT state FROM p2_signing_session WHERE case_id=$1",[id])).rows).toEqual([{state:'Active'}]);
   else expect((await owner.query('SELECT version FROM p2_workspace WHERE case_id=$1',[id])).rows).toEqual([{version:1}]);
  }
 }finally{
  await Promise.all([...apps,worker].map(c=>c.end().catch(()=>undefined)));await owner.end();key.fill(0);await rm(tmp,{recursive:true,force:true});
 }
},180000);
