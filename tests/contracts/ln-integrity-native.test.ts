import {it,expect} from 'vitest';
import {Client} from 'pg';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,randomInt} from 'node:crypto';
import {migrate} from '../../tools/migrate';
import {assertSyntheticDatabase} from '../../packages/db/connection';
import {hashPassword} from '../../packages/security/password';
import {FileStore} from '../../packages/storage';
import {buildSyntheticPet} from '../../packages/inbound/wire';
import {discoverInbound} from '../../packages/inbound/discovery';
import {processInboundFile} from '../../packages/inbound/process';
import {registerP2,type Staff} from '../../packages/p2/service';

// Plan Rev 3.4 §11A missing regressions 1–2, on real PostgreSQL sessions (explicit opt-in, disposable synthetic DB only).
// Existing protection is exercised as-is: advisory LN lock, case_ln UNIQUE(ln,version), his_order uniqueness, file state re-check.
it.skipIf(!process.env.NIPT_TEST_DATABASE_URL)('native LN integrity: concurrent different-HN registration, concurrent PET workers, concurrent discovery',async()=>{
 const url=process.env.NIPT_TEST_DATABASE_URL!;assertSyntheticDatabase(url);
 const owner=new Client({connectionString:url}),apps=[new Client({connectionString:url}),new Client({connectionString:url})],workers=[new Client({connectionString:url}),new Client({connectionString:url})];
 const tmp=await mkdtemp(path.join(os.tmpdir(),'nipt-ln-native-')),root=path.join(tmp,'simulator'),store=new FileStore(path.join(tmp,'files')),key=randomBytes(32),deps={store,lookupKey:key};
 try{
  await owner.connect();await migrate(owner);await owner.query(await readFile('packages/db/roles.sql','utf8'));await owner.query('GRANT SELECT,INSERT ON file_asset,case_event TO worker_rw');
  for(const c of apps){await c.connect();await c.query('SET ROLE app_rw');}for(const c of workers){await c.connect();await c.query('SET ROLE worker_rw');}
  await mkdir(path.join(root,'inbound'),{recursive:true});await writeFile(path.join(root,'.nipt-synthetic-root'),'NIPT_SYNTHETIC_ONLY_V1');
  const run=String(randomInt(100000,999999)),hash=await hashPassword('SYNTHETIC-NATIVE-PASSWORD-48!'),today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Bangkok'}).replace(/-/g,'');
  const unit=(await owner.query<{id:string}>("INSERT INTO unit(code,name) VALUES($1,'จำลอง') RETURNING id",['SYNTHETIC_LNI_'+run])).rows[0].id;
  const lab:Staff={id:(await owner.query<{id:string}>("INSERT INTO app_user(username,display_name,password_hash) VALUES($1,'จำลอง',$2) RETURNING id",[`synthetic.lni.lab.${run}`,hash])).rows[0].id,roles:['LAB_STAFF'],unitIds:[],permissions:[]};
  const tx=async<T>(client:Client,fn:()=>Promise<T>)=>{await client.query('BEGIN');try{const r=await fn();await client.query('COMMIT');return r;}catch(e){await client.query('ROLLBACK');throw e;}};
  const register=(client:Client,ln:string,hn:string,idempotencyKey:string)=>tx(client,async()=>{await new Promise(r=>setTimeout(r,randomInt(0,15)));return registerP2(client,lab,{ln,hn,unitId:unit,origin:'LAB_DIRECT',idempotencyKey,identifierSource:'TUBE_LABEL'},key,{store});});
  const writePet=async(ln:string,hn:string)=>{const p=buildSyntheticPet({ln,hn,receivedAt:today+'090000',specimenAt:today+'070000'}),dir=path.join(root,'inbound',today);await mkdir(dir,{recursive:true});await writeFile(path.join(dir,p.filename),p.bytes);await writeFile(path.join(dir,p.filename.replace('.pet','.ok')),'');};

  // 1. Same LN, different HN, two sessions at once: exactly one case; the other is an identity conflict, nothing created.
  for(let i=0;i<6;i++){
   const ln=`99000${run}1${i}`; // synthetic LN/HN space: ^0*990…
   const out=await Promise.all([register(apps[0],ln,'9900000001',`lni_a_${ln}`),register(apps[1],ln,'9900000002',`lni_b_${ln}`)]);
   expect(out.map(o=>o.outcome).sort()).toEqual(['CREATED','IDENTITY_UNVERIFIED']);
   expect(out.find(o=>o.outcome==='IDENTITY_UNVERIFIED')!.caseId).toBeNull();
   const counts=(await owner.query(`SELECT (SELECT count(*)::int FROM case_ln WHERE ln=$1) cases,(SELECT count(*)::int FROM case_unit_scope s JOIN case_ln l ON l.case_id=s.case_id WHERE l.ln=$1) scopes`,[ln])).rows[0];
   expect(counts).toEqual({cases:1,scopes:1});
  }
  // 2. Two PET workers on the same file at once: one applies S1, the other skips; a single HIS order and round receipt.
  for(let i=0;i<4;i++){
   const ln=`99000${run}2${i}`,hn='9900001001'; // PET synthetic space: ^0*99000…
   await register(apps[0],ln,hn,`lni_w_${ln}`);await writePet(ln,hn);
   // 3. Concurrent discovery of the same delivered file: one inbound row per content hash.
   await Promise.all(workers.map(w=>discoverInbound(w,store,{root,lookbackDays:1,lookupKey:key})));
   const files=(await owner.query<{id:string}>('SELECT id FROM his_inbound_file WHERE ln=$1',[ln])).rows;expect(files).toHaveLength(1);
   const outcomes=await Promise.all(workers.map(w=>tx(w,async()=>{await new Promise(r=>setTimeout(r,randomInt(0,15)));return processInboundFile(w,files[0].id,deps);})));
   const diag=(await owner.query('SELECT state,error_code FROM his_inbound_file WHERE ln=$1',[ln])).rows;
   expect(outcomes.sort(),JSON.stringify(diag)).toEqual(['APPLIED_S1','SKIPPED']);
   const st=(await owner.query(`SELECT (SELECT count(*)::int FROM his_order o JOIN case_ln l ON l.id=o.case_ln_id WHERE l.ln=$1) orders,(SELECT count(*)::int FROM specimen_round r JOIN case_ln l ON l.id=r.case_ln_id WHERE l.ln=$1 AND r.received_at IS NOT NULL) received,(SELECT count(*)::int FROM specimen_lab_number n JOIN specimen_round r ON r.id=n.round_id JOIN case_ln l ON l.id=r.case_ln_id WHERE l.ln=$1) ln_halos`,[ln])).rows[0];
   expect(st).toEqual({orders:1,received:1,ln_halos:1});
  }
 }finally{
  await Promise.all([...apps,...workers].map(c=>c.end().catch(()=>undefined)));await owner.end();key.fill(0);await rm(tmp,{recursive:true,force:true});
 }
},180000);
