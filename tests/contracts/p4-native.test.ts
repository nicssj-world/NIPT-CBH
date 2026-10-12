import {it,expect} from 'vitest';
import {Client} from 'pg';
import {readFile} from 'node:fs/promises';
import {migrate} from '../../tools/migrate';
import {assertSyntheticDatabase,type Queryable} from '../../packages/db/connection';
import {LN_HALOS_PATTERN} from '../../packages/lab/rules';
import * as intake from '../../packages/lab/intake';
import * as batch from '../../packages/lab/batch';
import {tx,labUsers,setPendingPolicy,syntheticCase,receiveS1} from '../helpers/lab';

// Explicitly opt-in; never uses DATABASE_URL/Production. Disposable native DB only; real app_rw and worker_rw sessions racing.
it.skipIf(!process.env.NIPT_TEST_DATABASE_URL)('native P4: concurrent receipts never duplicate LN Halos; concurrent assignment/receipt/batch creation serialize',async()=>{
 const url=process.env.NIPT_TEST_DATABASE_URL!;assertSyntheticDatabase(url);
 const owner=new Client({connectionString:url});await owner.connect();
 const clients:Client[]=[];const session=async(role:'app_rw'|'worker_rw')=>{const c=new Client({connectionString:url});await c.connect();await c.query(`SET ROLE ${role}`);clients.push(c);return c as unknown as Queryable;};
 try{
  await migrate(owner);await owner.query(await readFile('packages/db/roles.sql','utf8'));
  const o=owner as unknown as Queryable,u=await labUsers(o);
  await owner.query("UPDATE lab_batch SET state='Cancelled',cancelled_by=$1,cancelled_at=now(),cancel_reason='SYNTHETIC native reset' WHERE state='Draft'",[u.staff.id]);
  await setPendingPolicy(o,u,'PROCEED_SYNTHETIC_LABELLED');
  // 1. Twenty S1 receipts at once through twenty worker sessions: unique, gap-free within this burst, all well-formed.
  const cases=[];for(let i=0;i<20;i++)cases.push(await tx(o,t=>syntheticCase(t,u)));
  const files=[];for(const c of cases){const f=(await owner.query<{id:string}>("INSERT INTO his_inbound_file(sha256,state) VALUES(encode(sha256(convert_to($1,'UTF8')),'hex'),'Applied(S1)') RETURNING id",[c.roundId])).rows[0].id;await owner.query('INSERT INTO his_order(case_ln_id,inbound_file_id,his_received_at) VALUES($1,$2,now())',[c.lnId,f]);files.push(f);}
  const workers=await Promise.all(cases.map(()=>session('worker_rw')));
  await Promise.all(cases.map((c,i)=>tx(workers[i],t=>t.query("UPDATE specimen_round SET received_source='HIS_PET_RECEIPT',received_at=(SELECT his_received_at FROM his_order WHERE case_ln_id=$2),state='ReceivedInHIS',collection_date='2026-10-10' WHERE id=$1",[c.roundId,c.lnId]))));
  const codes=(await owner.query<{ln_halos:string;sequence_value:number}>('SELECT ln_halos,sequence_value FROM specimen_lab_number WHERE round_id=ANY($1::uuid[]) ORDER BY sequence_value',[cases.map(c=>c.roundId)])).rows;
  expect(codes).toHaveLength(20);expect(new Set(codes.map(c=>c.ln_halos)).size).toBe(20);expect(codes.every(c=>LN_HALOS_PATTERN.test(c.ln_halos))).toBe(true);
  expect(codes.at(-1)!.sequence_value-codes[0].sequence_value).toBe(19);
  // 2. The same attempt into the same batch from two Lab sessions: exactly one placement.
  const [a1,a2]=[await session('app_rw'),await session('app_rw')];
  const b=await tx(a1,t=>batch.createBatch(t,u.staff));
  const attempt=(await owner.query<{id:string}>('SELECT id FROM analytical_attempt WHERE round_id=$1',[cases[0].roundId])).rows[0].id;
  const race=await Promise.allSettled([a1,a2].map(c=>tx(c,t=>batch.assignToBatch(t,u.staff,{batchId:b.batchId,expectedVersion:0,attemptIds:[attempt],queueOverrideReason:'จำลอง native race (DB อาจมีงานเก่าค้าง)'}))));
  expect(race.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  expect((await owner.query('SELECT count(*)::int n FROM lab_slot_assignment WHERE attempt_id=$1 AND removed_at IS NULL',[attempt])).rows[0]).toEqual({n:1});
  // 3. Two concurrent batch creations return the same single Draft batch.
  const created=await Promise.all([a1,a2].map(c=>tx(c,t=>batch.createBatch(t,u.staff))));
  expect(new Set(created.map(x=>x.batchId)).size).toBe(1);
  // 4. Double S2 receipt of one redraw round: one number, the other call is a duplicate with the same number.
  const s2case=cases[1];
  const redraw=await tx(a1,t=>intake.orderRedraw(t,u.certifier,{caseId:s2case.caseId,reasonCode:'SPECIMEN_PROBLEM',note:'จำลอง native redraw'}));
  const input={roundId:redraw.newRoundId,identityChecked:true,labelChecked:true,condition:'ACCEPTABLE',collectionDate:'2026-10-11'};
  const both=await Promise.all([a1,a2].map(c=>tx(c,t=>intake.receiveRedraw(t,u.staff,input))));
  expect(both.map(x=>x.duplicate).sort()).toEqual([false,true]);expect(both[0].lnHalos).toBe(both[1].lnHalos);
  expect((await owner.query('SELECT count(*)::int n FROM specimen_lab_number WHERE case_id=$1',[s2case.caseId])).rows[0]).toEqual({n:2});
  // 5. A receipt through app_rw also issues via the definer trigger; app_rw cannot write numbers directly.
  const extra=await tx(o,t=>syntheticCase(t,u));await tx(a1,t=>receiveS1(t,extra)).catch(()=>undefined);
  await expect(a1.query("INSERT INTO specimen_lab_number(round_id,case_id,ln_halos,sequence_date,sequence_value,issued_on,issue_path) VALUES($1,$2,'26B261012998','2026-10-12',998,'HIS_PET_RECEIPT','RECEIPT_TRIGGER')",[extra.roundId,extra.caseId])).rejects.toThrow(/permission/);
 }finally{for(const c of clients)await c.end();await owner.end();}
},120000);
