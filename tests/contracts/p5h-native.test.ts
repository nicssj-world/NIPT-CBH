import {it,expect} from 'vitest';
import {Client} from 'pg';
import {randomUUID} from 'node:crypto';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {migrate} from '../../tools/migrate';
import {assertSyntheticDatabase,type Queryable} from '../../packages/db/connection';
import {FileStore} from '../../packages/storage';
import {tx,labUsers,syntheticCase} from '../helpers/lab';
import {proposeSetting,validateSetting,approveSetting,activateSetting} from '../../packages/settings/service';
import {createBatch,stageBatch,getBatch,confirmBatch} from '../../packages/historical/service';
import {csvOf,goodRow,pdfFor,attest,LOOKUP_KEY} from '../helpers/historical';
import type {Staff} from '../../packages/lab/core';

// Explicitly opt-in (never DATABASE_URL). Real app_rw / worker_rw sessions racing on PostgreSQL: AT-HIST-11/16 concurrency and idempotency.
it.skipIf(!process.env.NIPT_TEST_DATABASE_URL)('native P5H: one case per LN under races, idempotent batch confirmation, role boundaries',async()=>{
 const url=process.env.NIPT_TEST_DATABASE_URL!;assertSyntheticDatabase(url);
 const owner=new Client({connectionString:url});await owner.connect();const base=await mkdtemp(path.join(os.tmpdir(),'nipt-p5h-native-'));const store=new FileStore(path.join(base,'files'));
 const clients:Client[]=[];const session=async(role:'app_rw'|'worker_rw')=>{const c=new Client({connectionString:url});await c.connect();await c.query(`SET ROLE ${role}`);clients.push(c);return c as unknown as Queryable;};
 try{
  await migrate(owner);await owner.query(await readFile('packages/db/roles.sql','utf8'));
  const o=owner as unknown as Queryable,u=await labUsers(o);
  const run=String(Date.now()).slice(-5);
  const maker={...u.staff,permissions:['HISTORICAL_ENTRY']} as Staff;
  const vid=(await owner.query<{id:string}>("INSERT INTO app_user(username,display_name,password_hash) VALUES($1,'ผู้ตรวจจำลอง','$argon2id$v=19$synthetic') RETURNING id",[`synthetic.verifier.${run}`])).rows[0].id;
  await owner.query("INSERT INTO role_assignment(user_id,role) VALUES($1,'HISTORICAL_VERIFIER')",[vid]);
  const verifier={id:vid,roles:['HISTORICAL_VERIFIER'],unitIds:[],permissions:[]} as unknown as Staff;
  const activate=(key:string,value:unknown)=>tx(o,async t=>{const id=await proposeSetting(t,u.certifier,key,value,'SYNTHETIC_P5H_NATIVE');await validateSetting(t,u.certifier,id,async()=>true);await approveSetting(t,u.approver,id);await activateSetting(t,u.approver,id);});
  // The database persists between runs; once a HISTORICAL case exists the cutoff can no longer be re-activated (OD27_REQUIRED), so activate only when absent.
  const active=async(k:string)=>(await owner.query('SELECT 1 FROM setting_active WHERE setting_key=$1',[k])).rowCount;
  if(!(await active('go_live_cutoff')))await activate('go_live_cutoff',{cutoff:'2026-01-01',impactReportHash:'a'.repeat(64)});
  if(!(await active('historical_backfill')))await activate('historical_backfill',{anchorPolicy:'A_FINAL_REPORT',minimumProfile:'OD18_B_BALANCED',maxBatchRows:100});
  const [w1,w2,a1,a2]=[await session('worker_rw'),await session('worker_rw'),await session('app_rw'),await session('app_rw')];
  const lnOf=(n:number)=>`2612${run}${String(n).padStart(2,'0')}`;
  const rowsOf=(from:number,n:number)=>Array.from({length:n},(_,i)=>goodRow(from+i,{ln:lnOf(from+i),hn:`990${run}${String(from+i).padStart(2,'0')}`}));
  const stage=async(rows:ReturnType<typeof rowsOf>)=>{
   const {batchId}=await tx(a1,t=>createBatch(t,maker,store,{table:{name:'native.csv',bytes:csvOf(rows)},files:rows.map(r=>({name:r.pdf_file!,bytes:pdfFor(r)})),idempotencyKey:randomUUID()}));
   return batchId;
  };
  const rowsIn=async(batchId:string)=>(await owner.query<{id:string;version:number;state:string;ln:string}>('SELECT id,version,state,ln FROM historical_draft WHERE batch_id=$1 ORDER BY row_no',[batchId])).rows;
  const cases=async(like:string)=>Number((await owner.query<{n:string}>("SELECT count(*) n FROM case_ln l JOIN nipt_case c ON c.id=l.case_id WHERE c.registration_origin='HISTORICAL' AND l.ln LIKE $1",[like])).rows[0].n);

  // 1. Two worker sessions stage the same batch at once: the batch row lock makes it a single staging; no duplicate drafts.
  const b1=await stage(rowsOf(1,6));
  const staged=await Promise.allSettled([w1,w2].map(w=>tx(w,t=>stageBatch(t,store,b1,maker.id))).flat());
  expect(staged.every(s=>s.status==='fulfilled')).toBe(true);
  expect((await rowsIn(b1)).map(r=>r.state)).toEqual(Array(6).fill('Submitted'));

  // 2. Two verifiers' sessions confirm the same rows with the SAME key concurrently: one PROMOTED, the other ALREADY_PROMOTED, one case per LN.
  const asks=(await rowsIn(b1)).map(r=>({draftId:r.id,version:r.version,attestation:attest()}));
  const key=randomUUID();
  const same=await Promise.all([a1,a2].map(s=>tx(s,t=>confirmBatch(t,verifier,b1,LOOKUP_KEY,{idempotencyKey:key,rows:asks}))));
  const all=same.flatMap(r=>r.outcomes.map(o=>o.outcome)).sort();
  expect(all.filter(x=>x==='PROMOTED')).toHaveLength(6);
  expect(all.filter(x=>x==='ALREADY_PROMOTED')).toHaveLength(6);
  expect(await cases(`2612${run}%`)).toBe(6);

  // 3. Different keys racing for the same rows: exactly one wins per row; the loser is rejected, never a second case.
  const b2=await stage(rowsOf(11,4));await tx(w1,t=>stageBatch(t,store,b2,maker.id));
  const asks2=(await rowsIn(b2)).map(r=>({draftId:r.id,version:r.version,attestation:attest()}));
  const diff=await Promise.all([a1,a2].map(s=>tx(s,t=>confirmBatch(t,verifier,b2,LOOKUP_KEY,{idempotencyKey:randomUUID(),rows:asks2}))));
  const outs=diff.flatMap(r=>r.outcomes);
  expect(outs.filter(x=>x.outcome==='PROMOTED')).toHaveLength(4);
  expect(outs.filter(x=>x.outcome==='REJECTED'&&x.code==='ALREADY_PROMOTED')).toHaveLength(4);
  expect(await cases(`2612${run}1_`)).toBe(4);

  // 4. Promotion races a Lab registration of the same LN (AT-HIST-16): exactly one case_ln survives; the other side is refused.
  const b3=await stage(rowsOf(21,6));await tx(w1,t=>stageBatch(t,store,b3,maker.id));
  const asks3=(await rowsIn(b3)).map(r=>({draftId:r.id,version:r.version,attestation:attest()}));
  const registrations=(async()=>{const r:string[]=[];for(let i=0;i<asks3.length;i++)r.push(await tx(a2,t=>syntheticCase(t,{staff:u.staff,unit:u.unit},{ln:lnOf(21+i)})).then(()=>'REGISTERED',()=>'REFUSED'));return r;})();   // one session, sequential: a pg client runs one transaction at a time
  const [confirmed,regs]=await Promise.all([tx(a1,t=>confirmBatch(t,verifier,b3,LOOKUP_KEY,{idempotencyKey:randomUUID(),rows:asks3})),registrations]);
  for(let i=0;i<6;i++){
   const n=Number((await owner.query<{n:string}>('SELECT count(*) n FROM case_ln WHERE ln=$1',[lnOf(21+i)])).rows[0].n);
   expect(n,`LN ${i}`).toBe(1);
   // Whichever side wins, the loser opened the existing case or was refused/queued; never a second case_ln.
   expect(['PROMOTED','CONFLICT','REJECTED']).toContain(confirmed.outcomes[i].outcome);
   expect(['REGISTERED','REFUSED']).toContain(regs[i]);
  }

  // 5. Role boundaries on the real roles.
  const b4=await stage(rowsOf(31,1));await tx(w1,t=>stageBatch(t,store,b4,maker.id));
  const [d4]=await rowsIn(b4);expect(d4.state).toBe('Submitted');
  await expect(tx(a1,async t=>{await t.query("SELECT set_config('nipt.historical_promotion',$1,true)",[d4.id]);await t.query("UPDATE historical_draft SET state='Promoted',promoted_key=repeat('k',20),promoted_case_id=(SELECT id FROM nipt_case LIMIT 1) WHERE id=$1",[d4.id]);})).rejects.toThrow(/PROMOTION_ONLY_VIA_FUNCTION/);
  await expect(w1.query("UPDATE historical_draft SET data='{}' WHERE id=$1",[d4.id])).rejects.toThrow(/permission denied/);
  await expect(w1.query("UPDATE historical_draft SET promoted_key='x' WHERE id=$1",[d4.id])).rejects.toThrow(/permission denied/);
  await expect(w1.query("UPDATE historical_draft SET contributor_ids='{}' WHERE id=$1",[d4.id])).rejects.toThrow(/permission denied/);
  await expect(w1.query("INSERT INTO historical_verification(draft_id,draft_version,verifier_id,result,attestation,batch_key) SELECT id,version,$1,'CONFIRMED','{}','kkkkkkkkkkkkkkkkkkkk' FROM historical_draft LIMIT 1",[vid])).rejects.toThrow(/permission denied/);
  await expect(w1.query("SELECT historical_promote(id,id,repeat('a',64),repeat('k',20)) FROM historical_draft LIMIT 1")).rejects.toThrow();
  await expect(w1.query('SELECT payload FROM p2_document_revision LIMIT 1')).rejects.toThrow(/permission denied/);
  await expect(a1.query("UPDATE historical_eligibility_evaluation SET outcome='Submitted'")).rejects.toThrow(/permission denied|append-only/);
  await expect(a1.query('DELETE FROM historical_draft')).rejects.toThrow(/permission denied/);
  await expect(a1.query("INSERT INTO nipt_case(registration_origin,identity_key) VALUES('HISTORICAL',repeat('f',64))")).rejects.toThrow(/historical promotion disabled/);
  // Viewing a batch as the web role works with the real grants.
  expect((await tx(a1,t=>getBatch(t,verifier,b1))).rows).toHaveLength(6);
 }finally{
  for(const c of clients)await c.end().catch(()=>undefined);
  await owner.end();await rm(base,{recursive:true,force:true});
 }
},180000);
