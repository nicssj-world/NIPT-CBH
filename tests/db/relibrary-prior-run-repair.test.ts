import {it,expect} from 'vitest';
import {inboundFixture,register,writePet,cycle} from '../helpers/inbound';
import {attemptFacts,candidatePrintedId} from '../../packages/lab/core';

type Fixture=Awaited<ReturnType<typeof inboundFixture>>;
const patient=async(f:Fixture)=>{
 const ln='990001010077',hn='9900006207',caseId=await register(f,{ln,hn});
 await writePet(f.root,'20261101',{ln,hn,receivedAt:'20261101090000',specimenAt:'20261101080000'});
 await cycle(f,{now:new Date('2026-11-01T05:00:00Z')});
 const code=(await f.db.query<{ln_halos:string;round_id:string}>('SELECT n.ln_halos,n.round_id FROM specimen_lab_number n JOIN specimen_round r ON r.id=n.round_id WHERE r.case_id=$1',[caseId])).rows[0];
 return {caseId,...code};
};
const replica=async(f:Fixture,fn:()=>Promise<unknown>)=>{await f.db.exec('BEGIN');try{await f.db.exec('SET LOCAL session_replication_role=replica');await fn();await f.db.exec('COMMIT');}catch(e){await f.db.exec('ROLLBACK');throw e;}};
const repair=async(f:Fixture,code:string)=>(await f.db.query<{r:string}>('SELECT lab_repair_prior_run_relibrary($1) r',[code])).rows[0].r;

it('a received sample that has its LN Halos but no attempt is recorded as the Re-Library attempt -2, ready for a Task List',async()=>{
 const f=await inboundFixture();
 try{
  const p=await patient(f);
  expect(await repair(f,p.ln_halos)).toBe('ATTEMPT_ALREADY_EXISTS');            // an ordinary sample is never touched
  await replica(f,async()=>{await f.db.query('DELETE FROM attempt_event WHERE case_id=$1',[p.caseId]);await f.db.query('DELETE FROM analytical_attempt WHERE round_id=$1',[p.round_id]);});
  expect(await repair(f,'26B000000000')).toBe('NO_SUCH_LN_HALOS');
  expect(await repair(f,p.ln_halos)).toBe('REPAIRED');
  const rows=(await f.db.query<{attempt_number:number;state:string;level:string|null}>('SELECT a.attempt_number,a.state,w.level FROM analytical_attempt a LEFT JOIN repeat_work_order w ON w.id=a.repeat_order_id WHERE a.round_id=$1 ORDER BY 1',[p.round_id])).rows;
  expect(rows).toEqual([{attempt_number:1,state:'Superseded',level:null},{attempt_number:2,state:'Ready',level:'RE_LIBRARY'}]);
  const ready=(await attemptFacts(f.db,"a.round_id=$1 AND a.state='Ready'",[p.round_id]))[0];
  expect(candidatePrintedId(ready).id).toMatch(/-2$/);
  expect(await repair(f,p.ln_halos)).toBe('ATTEMPT_ALREADY_EXISTS');            // running it again changes nothing
 }finally{await f.close();}
},180000);
