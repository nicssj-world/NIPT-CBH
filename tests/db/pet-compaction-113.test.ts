import {beforeAll,afterAll,it,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase} from '../helpers/database';
let db:PGlite;
beforeAll(async()=>{db=await testDatabase();});afterAll(async()=>{await db?.close();});
it('P6 compacts only >24h empty successes into daily Bangkok summaries; events remain immutable',async()=>{
 const old=new Date(Date.now()-49*3600_000).toISOString();
 const now=new Date().toISOString();
 const add=async(trigger:string,outcome:string,count:Record<string,number>,finish:string,error:string|null=null)=>{
  await db.query("INSERT INTO his_inbound_scan_run(trigger,lookback_days,started_at,finished_at,outcome,counts,error_code) VALUES($1,7,$2::timestamptz-interval '1 second',$2,$3,$4,$5)",[trigger,finish,outcome,JSON.stringify(count),error]);
 };
 await add('INTERVAL','SUCCESS',{stored:0,parseError:0},old);
 await add('INTERVAL','SUCCESS',{stored:0,parseError:0},old);
 await add('INTERVAL','SUCCESS',{stored:0},now);
 await add('INTERVAL','SUCCESS',{stored:1},old);
 await add('MANUAL','SUCCESS',{stored:0},old);
 await add('INTERVAL','FAILED',{stored:0},old,'SHARE_PATH_NOT_FOUND');
 await add('INTERVAL','SUCCESS',{},old);
 const before=(await db.query<{n:number}>('SELECT count(*)::int n FROM his_inbound_scan_run')).rows[0].n;
 expect(before).toBe(7);
 await expect(db.query("DELETE FROM his_inbound_scan_run WHERE trigger='MANUAL'")).rejects.toThrow('SCAN_RECORD_IMMUTABLE');
 const removed=(await db.query<{n:number}>('SELECT compact_pet_empty_scans(500) n')).rows[0].n;
 expect(removed).toBe(2);
 const rows=(await db.query<{empty_success_runs:number}>('SELECT empty_success_runs FROM pet_scan_daily_empty_summary')).rows;
 expect(Number(rows[0].empty_success_runs)).toBe(2);
 expect((await db.query<{n:number}>('SELECT count(*)::int n FROM his_inbound_scan_run')).rows[0].n).toBe(5);
 expect((await db.query<{n:number}>('SELECT compact_pet_empty_scans(500) n')).rows[0].n).toBe(0);
 expect((await db.query<{n:number}>('SELECT count(*)::int n FROM his_inbound_scan_run')).rows[0].n).toBe(5);
});
