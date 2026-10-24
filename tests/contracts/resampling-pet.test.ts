import {beforeEach,afterEach,it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {utimes} from 'node:fs/promises';
import {printedSampleId} from '../../packages/lab/rules';
import {inboundFixture,register,registrar,writePet,cycle,caseState,rows,type InboundFixture} from '../helpers/inbound';
import {orderRedraw,labWorklist} from '../../packages/lab/intake';
import {tx,labUsers} from '../helpers/lab';

let f:InboundFixture;
const ln='990001009101',hn='9900001001',now=new Date('2026-10-14T06:00:00Z');
beforeEach(async()=>{f=await inboundFixture();});
afterEach(async()=>{await f.db.query('RESET ROLE');await f.close();});
async function initial(){
 const caseId=await register(f,{ln,hn});
 await writePet(f.root,'20261013',{ln,hn,receivedAt:'20261013080000'});
 await cycle(f,{now});
 const base=(await rows<{ln_halos:string}>(f.db,'SELECT ln_halos FROM specimen_lab_number WHERE case_id=$1',[caseId]))[0].ln_halos;
 const {lab}=await registrar(f.db);
 const {certifier}=await labUsers(f.db);
 const next=await tx(f.db,()=>orderRedraw(f.db,certifier,{caseId,reasonCode:'OTHER',note:'SYNTHETIC redraw due to specimen condition'}));
 return {caseId,base,lab,...next};
}
it('new same-LN PET applies only to expected S2, preserving S1 and base, worker role, then replay is idempotent',async()=>{
 const c=await initial();
 await f.db.exec(await readFile('packages/db/roles.sql','utf8'));
 await writePet(f.root,'20261014',{ln,hn,receivedAt:'20261014090000'});
 await f.db.query('SET ROLE worker_rw');
 const result=await cycle(f,{now});
 await f.db.query('RESET ROLE');
 expect(result.counts.outcome_APPLIED_REDRAW).toBe(1);
 const state=await caseState(f.db,c.caseId);
 expect(state.rounds.map(r=>[r.round_number,r.received_source,r.received_at?.toISOString()])).toEqual([
  [1,'HIS_PET_RECEIPT','2026-10-13T01:00:00.000Z'],[2,'HIS_PET_RECEIPT','2026-10-14T02:00:00.000Z']]);
 expect(state.orders).toHaveLength(2);
 expect(await rows(f.db,'SELECT ln_halos FROM specimen_lab_number WHERE round_id=$1',[c.newRoundId])).toEqual([{ln_halos:c.base}]);
 // Evidence for pregnancy type belongs to the current round.
 await f.db.query("INSERT INTO p2_paper_review(case_id,round_id,kind,template_version,document_reference,panel,status,location,reason,verifier_id) VALUES($1,$2,'REQUEST','SYNTHETIC-FM01-v1','SYNTHETIC-DOC','{\"pregnancyType\":\"Singleton\"}','Verified','SYNTHETIC-LOCATION','SYNTHETIC review',$3)",[c.caseId,c.newRoundId,c.lab.id]);
 const list=await labWorklist(f.db,c.lab);
 expect(JSON.stringify(list)).toContain(c.base+'R');
 await cycle(f,{now});
 expect((await caseState(f.db,c.caseId)).orders).toHaveLength(2);
 await expect(f.db.query("UPDATE specimen_round SET received_at=now() WHERE id=$1",[c.newRoundId])).rejects.toThrow('immutable');
});
it('new receipt without expected redraw remains a conflict, not an overwrite',async()=>{
 const caseId=await register(f,{ln,hn});await writePet(f.root,'20261013',{ln,hn,receivedAt:'20261013080000'});await cycle(f,{now});
 await writePet(f.root,'20261014',{ln,hn,receivedAt:'20261014090000'});await cycle(f,{now});
 expect((await caseState(f.db,caseId)).orders).toHaveLength(1);
 expect(await rows(f.db,"SELECT kind FROM his_intake_issue WHERE state='Open'")).toEqual([{kind:'S1_INTEGRITY_EVENT'}]);
});
it('wrong patient and old receipt cannot receive the expected round',async()=>{
 const c=await initial();
 await writePet(f.root,'20261014',{ln,hn:'9900009999',receivedAt:'20261014090000'});await cycle(f,{now});
 expect((await caseState(f.db,c.caseId)).rounds[1].received_at).toBeNull();
 expect(await rows(f.db,"SELECT kind FROM his_intake_issue WHERE state='Open'")).toEqual([{kind:'LN_REUSED_DIFFERENT_PATIENT'}]);
});
it('rewritten same filename, size and mtime is compared by content hash, then twin redraw prints DR',async()=>{
 const caseId=await register(f,{ln,hn});const fixed=new Date('2026-10-13T04:00:00Z');
 await writePet(f.root,'20261013',{ln,hn,receivedAt:'20261013080000'},{mtime:fixed});await cycle(f,{now});
 const {certifier}=await labUsers(f.db);
 await tx(f.db,()=>orderRedraw(f.db,certifier,{caseId,reasonCode:'OTHER',note:'SYNTHETIC redraw same filename'}));
 const changed=await writePet(f.root,'20261013',{ln,hn,receivedAt:'20261014090000'});await utimes(changed.path,fixed,fixed);
 expect((await cycle(f,{now})).counts.outcome_APPLIED_REDRAW).toBe(1);
 const numbers=await rows<{ln_halos:string}>(f.db,'SELECT ln_halos FROM specimen_lab_number WHERE case_id=$1',[caseId]);
 expect(printedSampleId({base:numbers[0].ln_halos,pregnancy:'Twins',attemptNumber:1,repeatLevel:null,earlierReLibraryCount:0,roundNumber:2,receivedSource:'HIS_PET_RECEIPT'})).toBe(numbers[0].ln_halos+'DR-1');
 expect(printedSampleId({base:numbers[0].ln_halos,pregnancy:'Twins',attemptNumber:1,repeatLevel:null,earlierReLibraryCount:0,roundNumber:3,receivedSource:'HIS_PET_RECEIPT'})).toBe(numbers[0].ln_halos+'DR-1');
});
