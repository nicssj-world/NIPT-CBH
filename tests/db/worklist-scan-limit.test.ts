import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase} from '../helpers/database';
import {tx,labUsers,setPendingPolicy,syntheticCase,receiveS1} from '../helpers/lab';
import {labWorklistPage,READY_SCAN_LIMIT,READY_HARD_LIMIT,type WorklistPage,type ScanTuning} from '../../packages/lab/worklist';
import type {Queryable} from '../../packages/db/connection';

// The Ready/Gate classification is exact inside a scan window (10 000 attempts in production). Behind that window the scan must keep going until the
// requested page is full, so an eligible case that sits behind many older Gate-blocked ones is never dropped and the FIFO order never changes.
// The window and chunk are shrunk through the tuning seam so a small fixture exercises exactly the same code path.
let db:PGlite,u:Awaited<ReturnType<typeof labUsers>>;
const q=()=>db as unknown as Queryable;
const run=<T,>(fn:(t:Queryable)=>Promise<T>)=>tx(q(),fn);
const GATE=30,ELIGIBLE=40,T0=Date.UTC(2026,9,1,2,0,0);
const tune={scanLimit:10,chunk:5};
const page=(raw:Record<string,unknown>,t:ScanTuning=tune)=>labWorklistPage(q(),u.staff,raw,t);
const eligibleLn:string[]=[];
async function every(tab:"READY"|"GATE_BLOCKED",extra:Record<string,unknown>,t:ScanTuning=tune,pageSize=25){
 const pages:WorklistPage[]=[];for(let p=1;p<200;p++){const d=await page({tab,page:p,pageSize,...extra},t);pages.push(d);if(p>=d.page.totalPages)break;}return pages;
}
beforeAll(async()=>{
 db=await testDatabase();u=await labUsers(q());await setPendingPolicy(q(),u,'PROCEED_SYNTHETIC_LABELLED');
 // the GATE oldest, so the first scan windows hold only Gate-blocked attempts; the eligible ones are the newest in FIFO order
 for(let i=0;i<GATE;i++){const c=await run(t=>syntheticCase(t,u,{evidence:false}));await run(t=>receiveS1(t,c,new Date(T0+i*60000)));}
 for(let i=0;i<ELIGIBLE;i++){const c=await run(t=>syntheticCase(t,u));await run(t=>receiveS1(t,c,new Date(T0+(GATE+i)*60000)));eligibleLn.push(c.ln);}
},300000);
afterAll(async()=>{await db?.close();});

describe('worklist scan window',()=>{
 it('production limits are the documented ones',()=>{expect(READY_SCAN_LIMIT).toBe(10000);expect(READY_HARD_LIMIT).toBe(100000);});
 it('eligible cases behind the window are reachable, in FIFO order, with the same rows as an unlimited scan',async()=>{
  const full=await every('READY',{},{});expect(full[0].scan.capped).toBe(false);
  const fullIds=full.flatMap(d=>d.attempts.map(a=>a.attemptId));expect(fullIds).toHaveLength(ELIGIBLE);
  expect(full.flatMap(d=>d.attempts.map(a=>a.hisLn))).toEqual(eligibleLn);                 // FIFO = receive time ascending
  const limited=await every('READY',{});
  expect(limited.flatMap(d=>d.attempts.map(a=>a.attemptId))).toEqual(fullIds);               // nothing dropped, same order
  expect(limited.at(-1)!.scan.capped).toBe(false);                                           // the final page has scanned everything
  // page 1 is full but unscanned attempts remain: the response is capped and "next" stays available
  const first=limited[0];expect(first.attempts).toHaveLength(25);expect(first.scan.capped).toBe(true);expect(first.page.totalPages).toBe(Math.ceil(first.page.total/25)+1);
  expect(limited).toHaveLength(2);
 });
 it('newest-first (desc) is also complete and reversed, and gate-blocked rows are complete too',async()=>{
  const asc=(await every('READY',{sort:'asc'})).flatMap(d=>d.attempts.map(a=>a.attemptId));
  const desc=(await every('READY',{sort:'desc'})).flatMap(d=>d.attempts.map(a=>a.attemptId));
  expect(desc).toEqual([...asc].reverse());
  const gate=(await every('GATE_BLOCKED',{})).flatMap(d=>d.attempts.map(a=>a.attemptId)),gateFull=(await every('GATE_BLOCKED',{},{})).flatMap(d=>d.attempts.map(a=>a.attemptId));
  expect(gate).toHaveLength(GATE);expect(gate).toEqual(gateFull);
 });
 it('a filter that only matches eligible cases behind the window still finds them',async()=>{
  const target=eligibleLn.at(-1)!;
  const d=await page({tab:'READY',q:target,pageSize:25});expect(d.attempts.map(a=>a.hisLn)).toEqual([target]);expect(d.page.total).toBe(1);
 });
 it('when the window is exceeded the response says so and counts are a lower bound; exact when everything was scanned',async()=>{
  const d=await page({tab:'READY',page:1,pageSize:25});
  expect(d.scan).toMatchObject({capped:true,limit:10});expect(d.scan.scanned).toBeLessThan(d.scan.ready);expect(d.scan.ready).toBe(GATE+ELIGIBLE);
  const exact=await page({tab:'READY',page:1,pageSize:25},{});expect(exact.scan).toMatchObject({capped:false,scanned:GATE+ELIGIBLE,ready:GATE+ELIGIBLE});
  expect(exact.counts).toMatchObject({READY:ELIGIBLE,GATE_BLOCKED:GATE});
  const hard=await page({tab:'READY',page:1,pageSize:25},{scanLimit:10,chunk:5,hardLimit:20});expect(hard.scan.capped).toBe(true);expect(hard.scan.ready).toBe(20); // the id list itself is bounded
 });
 it('PHI audit covers only the rows disclosed on that page',async()=>{
  const before=Number((await db.query<{n:string}>("SELECT count(*)::text n FROM phi_access_log")).rows[0].n);
  const d=await page({tab:'READY',page:1,pageSize:25});
  const after=Number((await db.query<{n:string}>("SELECT count(*)::text n FROM phi_access_log")).rows[0].n);
  expect(after-before).toBe(new Set(d.attempts.map(a=>a.caseId)).size);
 });
});
