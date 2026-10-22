import {it,expect} from 'vitest';
import {Client} from 'pg';
import {migrate} from '../../tools/migrate';
import {assertSyntheticDatabase,type Queryable} from '../../packages/db/connection';
import {labUsers,syntheticCase,receiveS1,attemptOf,tx} from '../helpers/lab';
import {orderRepeat} from '../../packages/lab/intake';
it.skipIf(!process.env.NIPT_TEST_DATABASE_URL)('native LAB repeat-order state changes retain immutable case/round/attempt lineage',async()=>{
 const url=process.env.NIPT_TEST_DATABASE_URL!;assertSyntheticDatabase(url);const client=new Client({connectionString:url});await client.connect();
 const db=client as unknown as Queryable;
 try{
  await migrate(db);const u=await labUsers(db),c=await tx(db,t=>syntheticCase(t,{staff:u.staff,unit:u.unit}));await tx(db,t=>receiveS1(t,c));
  const a=await attemptOf(db,c.roundId);await db.query("UPDATE analytical_attempt SET state='Stopped' WHERE id=$1",[a.id]);
  const repeat=await tx(db,t=>orderRepeat(t,u.staff,{attemptId:a.id,level:'RE_LIBRARY',reasonCode:'STOPPED_BY_LAB',note:'DISPOSABLE SYNTHETIC native lineage trigger test'}));
  await tx(db,t=>t.query("UPDATE repeat_work_order SET state='RepeatInProgress' WHERE id=$1",[repeat.repeatOrderId]));
  expect((await db.query<{state:string}>('SELECT state FROM repeat_work_order WHERE id=$1',[repeat.repeatOrderId])).rows[0].state).toBe('RepeatInProgress');
  await expect(tx(db,t=>t.query('UPDATE repeat_work_order SET round_id=gen_random_uuid() WHERE id=$1',[repeat.repeatOrderId]))).rejects.toThrow('immutable work lineage');
  await expect(tx(db,t=>t.query('UPDATE analytical_attempt SET attempt_number=3 WHERE id=$1',[repeat.attemptId]))).rejects.toThrow('immutable attempt lineage');
 }finally{await client.end();}
},120000);
