import {it,expect,beforeAll,afterAll} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase} from '../helpers/database';
import {tx,labUsers,setPendingPolicy,syntheticCase,receiveS1} from '../helpers/lab';
import * as batch from '../../packages/lab/batch';
import {labWorklistPage} from '../../packages/lab/worklist';
import type {Queryable} from '../../packages/db/connection';

// Owner 2026-11-03: Task fill and the ready queue run in LN Halos order, even when HIS receipt times arrive out of order;
// the queue fill and the manual-fill list offer the same samples.
let db:PGlite,u:Awaited<ReturnType<typeof labUsers>>;
const q=()=>db as unknown as Queryable;
const run=<T,>(fn:(t:Queryable)=>Promise<T>)=>tx(q(),fn);
const halos=async(roundId:string)=>(await db.query<{ln_halos:string}>('SELECT ln_halos FROM specimen_lab_number WHERE round_id=$1',[roundId])).rows[0].ln_halos;
const T0=Date.UTC(2026,9,1,2,0,0);
const cases:Awaited<ReturnType<typeof syntheticCase>>[]=[];

beforeAll(async()=>{
 db=await testDatabase();u=await labUsers(q());await setPendingPolicy(q(),u,'PROCEED_SYNTHETIC_LABELLED');
 // Received (and therefore numbered) in this order, but with HIS receipt times in the opposite order.
 for(let i=0;i<5;i++){const c=await run(t=>syntheticCase(t,u));await run(t=>receiveS1(t,c,new Date(T0-i*60000)));cases.push(c);}
},300000);
afterAll(async()=>{await db?.close();});

it('the fill proposal, the worklist and the manual-fill list all follow LN Halos, not the HIS receipt time',async()=>{
 const numbers=await Promise.all(cases.map(c=>halos(c.roundId)));
 const sorted=[...numbers].sort();
 expect(numbers).toEqual(sorted);   // issued in registration order
 const b=await run(t=>batch.createBatch(t,u.staff));
 const preview=await run(t=>batch.previewFill(t,u.staff,{batchId:b.batchId,sheetNumber:1}));
 const proposed=preview.candidates.map(c=>c.attemptId);
 const list=(await labWorklistPage(q(),u.staff,{tab:'READY',page:1,pageSize:50})).attempts;
 const listed=list.map(a=>a.lnHalos);
 expect(listed).toEqual(sorted);                                    // the list the manual fill chooses from
 expect(proposed).toEqual(list.map(a=>a.attemptId));                 // and the queue fill takes exactly that order
});

it('the manual-fill list and the queue fill exclude an imported historical result alike',async()=>{
 const b=await run(t=>batch.createBatch(t,u.staff));
 const attempt=(await db.query<{id:string;case_id:string;round_id:string}>('SELECT id,case_id,round_id FROM analytical_attempt WHERE round_id=$1',[cases[2].roundId])).rows[0];
 const has=(await db.query<{p:boolean}>("SELECT to_regclass('public.migration_record') IS NOT NULL p")).rows[0].p;
 expect(has).toBe(true);
 await db.exec('BEGIN');
 try{
  await db.exec('SET LOCAL session_replication_role=replica');
  const user=(await db.query<{id:string}>("SELECT id FROM app_user LIMIT 1")).rows[0].id;
  const x=(await db.query<{id:string}>("INSERT INTO migration_execution(plan_digest,plan,created_by) VALUES($1,'{}',$2) RETURNING id",['a'.repeat(64),user])).rows[0];
  await db.query("INSERT INTO migration_record(execution_id,source_key,row_number,ln,ln_halos,classification,case_id,round_id,attempt_id,state) VALUES($1,'k',2,'0012345678','26B261020101','PDF_REVIEW',$2,$3,$4,'IMPORTED')",[x.id,attempt.case_id,attempt.round_id,attempt.id]);
  await db.exec('COMMIT');
 }catch(e){await db.exec('ROLLBACK');throw e;}
 const proposed=(await run(t=>batch.previewFill(t,u.staff,{batchId:b.batchId,sheetNumber:1}))).candidates.map(c=>c.attemptId);
 const listed=(await labWorklistPage(q(),u.staff,{tab:'READY',page:1,pageSize:50})).attempts.map(a=>a.attemptId);
 expect(proposed).not.toContain(attempt.id);
 expect(listed).not.toContain(attempt.id);
 expect(proposed).toEqual(listed);
});
