import {afterEach,beforeEach,expect,it} from 'vitest';
import {inboundFixture,writePet,rows,type InboundFixture} from '../helpers/inbound';
import {runInboundCycle} from '../../packages/inbound/cycle';
import {inboundHealth} from '../../packages/inbound/health';
let f:InboundFixture;
const at=new Date('2026-11-05T05:00:00Z');
beforeEach(async()=>{f=await inboundFixture();});
afterEach(async()=>{await f.close();});
const scan=(seconds:number,configurationId='config-a',source?:{id:string;assert():Promise<void>;file(relative:string):Promise<string>})=>runInboundCycle(f.db,{...f.deps,source},{trigger:'INTERVAL',lookbackDays:3,intervalSeconds:30,configurationId,now:()=>new Date(at.getTime()+seconds*1000)});
it('repeated empty automatic scans update heartbeat without growing immutable events or audit',async()=>{
 for(let i=0;i<4;i++)await scan(i*30);
 expect(await rows(f.db,'SELECT * FROM his_inbound_scan_run')).toHaveLength(0);
 expect(await rows(f.db,"SELECT * FROM audit_chain WHERE action='INBOUND_SCAN_COMPLETED'")).toHaveLength(0);
 const state=(await rows<{heartbeat_at:Date;last_success_at:Date;consecutive_failures:number}>(f.db,'SELECT * FROM his_inbound_scan_state'))[0];
 expect(new Date(state.heartbeat_at)).toEqual(new Date(at.getTime()+90000));expect(state.consecutive_failures).toBe(0);
 expect(new Date(state.last_success_at)).toEqual(new Date(at.getTime()+90000));
});
it('empty recovery clears backoff while skipped retries keep actual failure time and meaningful recovery evidence',async()=>{
 const source={id:'synthetic',assert:async()=>{throw Error('SHARE_PATH_NOT_FOUND');},file:async(p:string)=>p};
 await expect(scan(0,'config-a',source)).rejects.toThrow();
 expect((await scan(10)).outcome).toBe('SKIPPED_BACKOFF');
 expect((await scan(30)).outcome).toBe('SUCCESS');
 expect((await scan(31)).outcome).toBe('SUCCESS');
 const health=await inboundHealth(f.db,{enabled:true,intervalSeconds:30,configurationId:'config-a'},new Date(at.getTime()+31000));
 expect(health).toMatchObject({Alive:true,healthy:true,consecutiveFailures:0,LastError:null});
 expect((await rows<{outcome:string}>(f.db,'SELECT outcome FROM his_inbound_scan_run ORDER BY finished_at')).map(x=>x.outcome)).toEqual(['SHARE_UNAVAILABLE','SUCCESS']);
});
it('configuration identity isolates old heartbeat/backoff and disabled integrations are not alive',async()=>{
 await scan(0);
 expect(await inboundHealth(f.db,{enabled:true,intervalSeconds:30,configurationId:'config-b'},at)).toMatchObject({Alive:false,LastSuccess:null,consecutiveFailures:0,shareStatus:'UNKNOWN'});
 expect(await inboundHealth(f.db,{enabled:false,intervalSeconds:30,configurationId:'config-a'},at)).toMatchObject({Alive:false,healthy:false});
 expect(await inboundHealth(f.db,{enabled:true,intervalSeconds:30,configurationId:'config-a'},new Date(at.getTime()+91000))).toMatchObject({Alive:false,healthy:false});
});
it('new waiting files and ready PETs keep events; unchanged files do not; manual and deep scans always keep evidence',async()=>{
 await writePet(f.root,'20261105',{ln:'990001000001',hn:'9900001001',receivedAt:'20261105090000'},{ok:false});
 await scan(0);await scan(30);
 expect(await rows(f.db,'SELECT * FROM his_inbound_scan_run')).toHaveLength(1);
 await writePet(f.root,'20261105',{ln:'990001000001',hn:'9900001001',receivedAt:'20261105090000'});
 await scan(60);await scan(90);
 expect(await rows(f.db,'SELECT * FROM his_inbound_scan_run')).toHaveLength(2);
 for(const trigger of ['MANUAL','DEEP'] as const)await runInboundCycle(f.db,f.deps,{trigger,lookbackDays:3,intervalSeconds:30,configurationId:'config-a',now:()=>new Date(at.getTime()+120000)});
 expect(await rows(f.db,'SELECT * FROM his_inbound_scan_run')).toHaveLength(4);
 expect(await rows(f.db,"SELECT * FROM audit_chain WHERE action='INBOUND_SCAN_COMPLETED'")).toHaveLength(4);
 await expect(f.db.query('DELETE FROM his_inbound_scan_run')).rejects.toThrow(/append-only/i);
});
it('pre-summary immutable historical evidence remains readable, while a new summary becomes authoritative',async()=>{
 await f.db.query("INSERT INTO his_inbound_scan_run(trigger,lookback_days,started_at,finished_at,outcome,counts,error_code) VALUES('INTERVAL',3,$1,$1,'SHARE_UNAVAILABLE','{}','SHARE_PATH_NOT_FOUND')",[at]);
 expect(await inboundHealth(f.db,{enabled:true,intervalSeconds:30},at)).toMatchObject({Alive:true,healthy:false,consecutiveFailures:1,LastError:'SHARE_PATH_NOT_FOUND'});
 await scan(30);
 expect(await inboundHealth(f.db,{enabled:true,intervalSeconds:30},new Date(at.getTime()+30000))).toMatchObject({Alive:true,healthy:true,consecutiveFailures:0,LastError:null});
 expect((await rows<{outcome:string}>(f.db,'SELECT outcome FROM his_inbound_scan_run'))[0].outcome).toBe('SHARE_UNAVAILABLE');
});
