import {Pool} from 'pg';
import {describe,it,expect} from 'vitest';
import {migrate} from '../../tools/migrate';
import {registerCase} from '../../packages/db/registration';
import {assertSyntheticDatabase} from '../../packages/db/connection';
const url=process.env.NIPT_TEST_DATABASE_URL;
describe.skipIf(!url)('isolated native PostgreSQL concurrency',()=>{
 it('serializes eight genuinely concurrent registration transactions across clients',async()=>{
 assertSyntheticDatabase(url!);const pool=new Pool({connectionString:url,max:10});
 try {
 const migrationClient=await pool.connect();try{await migrate(migrationClient);}finally{migrationClient.release();}
 const ln=`009${Date.now()}`;
 const results=await Promise.all(Array.from({length:8},async(_,i)=>{const client=await pool.connect();try{await client.query('BEGIN');const result=await registerCase(client,{ln,identityKey:'c'.repeat(64),origin:i%2?'ANC':'LAB_DIRECT',idempotencyKey:`native_concurrency_${ln}_${i}`});await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}));
 expect(results.filter(r=>r.outcome==='CREATED')).toHaveLength(1);expect(results.filter(r=>r.outcome==='OPENED')).toHaveLength(7);expect(new Set(results.map(r=>r.caseId)).size).toBe(1);
 const count=await pool.query('SELECT count(*)::int AS count FROM case_ln WHERE ln=$1',[ln]);expect(count.rows[0].count).toBe(1);
 }finally{await pool.end();}
 });
});
