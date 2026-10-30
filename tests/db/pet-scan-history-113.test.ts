import {beforeAll,afterAll,it,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase,addUser} from '../helpers/database';
import {inboundQueuePage} from '../../packages/inbound/queue';
let db:PGlite;
beforeAll(async()=>{db=await testDatabase();});
afterAll(async()=>{await db?.close();});
it('P6: previous routine 0/0 is hidden, recent 0/0, old parse/failure, manual and stored PET remain visible',async()=>{
 const user=await addUser(db,'APP_ADMIN','synthetic.p6.history');
 const old=new Date(Date.now()-48*3600000).toISOString(),recent=new Date(Date.now()-15*60000).toISOString();
 const add=async(trigger:string,outcome:string,counts:Record<string,number>,finished:string)=>
  db.query("INSERT INTO his_inbound_scan_run(trigger,lookback_days,started_at,finished_at,outcome,counts) VALUES($1,7,$4::timestamptz - interval '1 second',$4,$2,$3)",[trigger,outcome,JSON.stringify(counts),finished]);
 await add('INTERVAL','SUCCESS',{stored:0,parseError:0,readError:0},old);
 await add('INTERVAL','SUCCESS',{stored:0,parseError:0,readError:0},recent);
 await add('INTERVAL','SUCCESS',{stored:1,parseError:0,readError:0},old);
 await add('INTERVAL','PARTIAL',{stored:0,parseError:1,readError:0},old);
 await add('MANUAL','SUCCESS',{stored:0,parseError:0,readError:0},old);
 await add('INTERVAL','SUCCESS',{},old);
 await add('INTERVAL','SUCCESS',{stored:0,parseError:0,newUnexpectedCount:1},old);
 const data=await inboundQueuePage(db,user,{pageSize:25});
 expect(data.runs.page.total).toBe(6);
 expect(data.runs.rows).toHaveLength(6);
 expect(data.runs.rows.some(r=>r.outcome==='PARTIAL')).toBe(true);
});
