import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase} from '../helpers/database';
import {tx,labUsers,setPendingPolicy,syntheticCase,receiveS1,attemptOf} from '../helpers/lab';
import * as intake from '../../packages/lab/intake';
import * as batch from '../../packages/lab/batch';
import {labWorklist,labWorklistPage,worklistRow,WORKLIST_TABS,type WorklistPage,type WorklistTab} from '../../packages/lab/worklist';
import {attemptFacts,pendingPolicy,caseVisible} from '../../packages/lab/core';
import {compareReceive} from '../../packages/lab/receive-sort';
import type {Queryable} from '../../packages/db/connection';

// The Lab worklist is served one bounded page per request. These tests prove the page API loses nothing, keeps the Owner-locked FIFO and
// eligibility classification, filters on the server across ALL rows, and writes a PHI-access audit for exactly the rows it disclosed.
let db:PGlite,u:Awaited<ReturnType<typeof labUsers>>;
const q=()=>db as unknown as Queryable;
const run=<T,>(fn:(t:Queryable)=>Promise<T>)=>tx(q(),fn);
const READY=44,GATE=21,IN_BATCH=9,CANCELLED=3;
const eligible:Awaited<ReturnType<typeof syntheticCase>>[]=[];let twins:Awaited<ReturnType<typeof syntheticCase>>,missingRound:string,redrawCase:string;
// Position in `eligible` -> where the case ends up: 0..8 in an open Run (IN_BATCH), 9..39 still Ready, 40 redraw ordered (leaves the attempt list),
// 41..43 in a Run that was finalized and then cancelled by the certifier (BatchCancelled = needs a decision).
const version=async(id:string)=>(await db.query<{version:number}>('SELECT version FROM lab_batch WHERE id=$1',[id])).rows[0].version;
const T0=Date.UTC(2026,9,1,2,0,0);
const page=(raw:Record<string,unknown>)=>labWorklistPage(q(),u.staff,raw);
async function everyPage(tab:WorklistTab,extra:Record<string,unknown>={},pageSize=25){
 const rows:WorklistPage[]=[];for(let p=1;;p++){const d=await page({tab,page:p,pageSize,...extra});rows.push(d);if(p>=d.page.totalPages)return rows;}
}
const idsOf=(pages:WorklistPage[])=>pages.flatMap(d=>d.attempts.map(a=>a.attemptId));

beforeAll(async()=>{
 db=await testDatabase();u=await labUsers(q());await setPendingPolicy(q(),u,'PROCEED_SYNTHETIC_LABELLED');
 const at=(i:number)=>new Date(T0+i*60000);
 for(let i=0;i<READY;i++){const c=await run(t=>syntheticCase(t,u,i===5||i===20?{pregnancy:'Twins'}:{}));await run(t=>receiveS1(t,c,at(i)));eligible.push(c);if(i===20)twins=c;}
 for(let i=0;i<GATE;i++){const c=await run(t=>syntheticCase(t,u,{evidence:false}));await run(t=>receiveS1(t,c,at(READY+i)));}
 // a finalized Run that is then cancelled leaves attempts that need a decision
 const cancelled=await run(t=>batch.createBatch(t,u.staff));
 const bad=eligible.slice(READY-CANCELLED);
 await run(async t=>batch.assignToBatch(t,u.staff,{batchId:cancelled.batchId,expectedVersion:0,attemptIds:await Promise.all(bad.map(async c=>(await attemptOf(t,c.roundId)).id)),queueOverrideReason:'จำลอง ทดสอบ Batch ยกเลิก'}));
 await run(async t=>batch.updateSheetPlan(t,u.staff,{batchId:cancelled.batchId,expectedVersion:await version(cancelled.batchId),sheetNumber:1,plannedWorkDate:'2026-10-12',plannedOperator:'จำลอง ผู้ปฏิบัติ',plannedExtractionLot:null,plannedExtractionExpiry:null,plannedLibraryLot:null,plannedLibraryExpiry:null}));
 await run(async t=>batch.planCheck(t,u.staff,{batchId:cancelled.batchId,expectedVersion:await version(cancelled.batchId),sheetNumber:1,confirm:{controlsAtTemplate:true,identifiersMatch:true,noDuplicates:true}}));
 await run(async t=>batch.finalizeSheet(t,u.staff,{batchId:cancelled.batchId,expectedVersion:await version(cancelled.batchId),sheetNumber:1}));
 await run(async t=>batch.cancelBatch(t,u.certifier,{batchId:cancelled.batchId,expectedVersion:await version(cancelled.batchId),reason:'SYNTHETIC cancel for worklist paging'}));
 const open=await run(t=>batch.createBatch(t,u.staff));
 const inBatch=eligible.slice(0,IN_BATCH);
 await run(async t=>batch.assignToBatch(t,u.staff,{batchId:open.batchId,expectedVersion:0,attemptIds:await Promise.all(inBatch.map(async c=>(await attemptOf(t,c.roundId)).id))}));
 // one expected redraw, one round received before P4 (no LN Halos)
 redrawCase=eligible[READY-CANCELLED-1].caseId;await run(t=>intake.orderRedraw(t,u.certifier,{caseId:redrawCase,reasonCode:'SPECIMEN_PROBLEM',note:'จำลอง หลอดมีปัญหา'}));
 const m=await run(t=>syntheticCase(t,u));await db.query('ALTER TABLE specimen_round DISABLE TRIGGER p4_receipt_issue');await run(t=>receiveS1(t,m,at(200)));await db.query('ALTER TABLE specimen_round ENABLE TRIGGER p4_receipt_issue');missingRound=m.roundId;
},300000);
afterAll(async()=>{await db?.close();});

describe('every tab is reachable page by page and the totals are exact',()=>{
 it('nothing is lost or repeated: the pages of the four attempt tabs are exactly the legacy full list',async()=>{
  const legacy=await labWorklist(q(),u.staff);
  const seen=new Set<string>();let sum=0;
  for(const tab of ['READY','GATE_BLOCKED','IN_BATCH','DECISION'] as const){
   const pages=await everyPage(tab);const ids=idsOf(pages);
   expect(new Set(ids).size,tab).toBe(ids.length);                              // no repeats inside a tab
   expect(ids.length,tab).toBe(pages[0].page.total);                            // total == rows reachable by paging
   expect(pages[0].counts[tab],tab).toBe(ids.length);                           // the tab badge is the same number
   for(const id of ids){expect(seen.has(id),`${tab} ${id}`).toBe(false);seen.add(id);}
   sum+=ids.length;
   for(const d of pages)for(const a of d.attempts)expect(['READY','GATE_BLOCKED','IN_BATCH','IN_PROGRESS','QC_FAILED','NEEDS_DECISION','OTHER']).toContain(a.category);
  }
  expect(sum).toBe(legacy.attempts.length);expect(seen).toEqual(new Set(legacy.attempts.map(a=>a.attemptId)));
  // 44 eligible + 21 gate-blocked cases, minus the redraw case (its current round is the new, not yet received round 2 -> it is in the Expected tab)
  expect(sum).toBe(READY+GATE-1);
 });
 it('the Ready tab holds the Owner-locked eligible set in FIFO order; Gate holds the rest; categories match the legacy classification',async()=>{
  const legacy=await labWorklist(q(),u.staff);
  const ready=idsOf(await everyPage('READY')),gate=idsOf(await everyPage('GATE_BLOCKED'));
  expect(ready).toEqual(legacy.attempts.filter(a=>a.category==='READY').map(a=>a.attemptId));
  expect(gate).toEqual(legacy.attempts.filter(a=>a.category==='GATE_BLOCKED').map(a=>a.attemptId));
  const rows=(await everyPage('READY')).flatMap(d=>d.attempts);
  for(let i=1;i<rows.length;i++)expect(compareReceive({receivedAt:rows[i-1].receivedAt,keys:[rows[i-1].hisLn,rows[i-1].attemptId]},{receivedAt:rows[i].receivedAt,keys:[rows[i].hisLn,rows[i].attemptId]},'asc')).toBeLessThanOrEqual(0);
  const desc=(await everyPage('READY',{sort:'desc'})).flatMap(d=>d.attempts).map(a=>a.attemptId);
  expect(desc).toEqual([...ready].reverse());
 });
 it('expected redraws and rounds without LN Halos are paged with exact totals',async()=>{
  const exp=await page({tab:'REDRAW_EXPECTED',pageSize:25});expect(exp.page.total).toBe(1);expect(exp.expected.map(e=>e.caseId)).toEqual([redrawCase]);expect(exp.counts.REDRAW_EXPECTED).toBe(1);
  const miss=await page({tab:'LN_HALOS_MISSING',pageSize:25});expect(miss.page.total).toBe(1);expect(miss.missing.map(m=>m.roundId)).toEqual([missingRound]);expect(miss.counts.LN_HALOS_MISSING).toBe(1);
 });
 it('counts for every tab are on every response; page past the end gives the last real page; bad input is refused',async()=>{
  const d=await page({tab:'READY',page:1,pageSize:25});expect(Object.keys(d.counts).sort()).toEqual([...WORKLIST_TABS].sort());
  const past=await page({tab:'READY',page:999,pageSize:25});expect(past.page.number).toBe(past.page.totalPages);expect(past.attempts.length).toBeGreaterThan(0);
  await expect(page({tab:'READY',pageSize:30})).rejects.toThrow();await expect(page({tab:'NOPE'})).rejects.toThrow();await expect(page({page:0})).rejects.toThrow();await expect(page({unknown:1})).rejects.toThrow();
  expect(d.scan).toEqual({capped:false,limit:10000});
 });
});

describe('the paged result equals the original load-everything algorithm (independent re-implementation)',()=>{
 it('same population, same category per attempt, same FIFO order per tab, same gate decisions',async()=>{
  const {policy}=await pendingPolicy(q());
  // the original algorithm: read the facts of EVERY live attempt, classify in TypeScript, sort FIFO, filter by visibility
  const full=(await attemptFacts(q(),"c.current_round_id=a.round_id AND c.registration_origin<>'HISTORICAL' AND a.attempt_number=(SELECT max(x.attempt_number) FROM analytical_attempt x WHERE x.round_id=a.round_id)",[]))
   .filter(r=>caseVisible(u.staff,r)).sort((a,b)=>compareReceive({receivedAt:a.received_at,keys:[a.ln,a.attempt_id]},{receivedAt:b.received_at,keys:[b.ln,b.attempt_id]},'asc')).map(r=>worklistRow(r,policy));
  const tabOf=(c:string):WorklistTab=>c==='READY'?'READY':c==='GATE_BLOCKED'?'GATE_BLOCKED':['IN_BATCH','IN_PROGRESS'].includes(c)?'IN_BATCH':'DECISION';
  for(const tab of ['READY','GATE_BLOCKED','IN_BATCH','DECISION'] as const){
   const expected=full.filter(a=>tabOf(a.category)===tab),got=(await everyPage(tab,{},25)).flatMap(d=>d.attempts);
   expect(got.map(a=>a.attemptId),tab).toEqual(expected.map(a=>a.attemptId));
   expect(got.map(a=>[a.category,a.gate?.eligible??null,a.gate?.failed??null,a.labelCode,a.printedSampleId,a.urgent]),tab).toEqual(expected.map(a=>[a.category,a.gate?.eligible??null,a.gate?.failed??null,a.labelCode,a.printedSampleId,a.urgent]));
  }
  expect(full.filter(a=>tabOf(a.category)==='READY').length).toBeGreaterThan(25); // the Ready tab really spans several pages
  expect(full.some(a=>tabOf(a.category)==='DECISION')&&full.some(a=>tabOf(a.category)==='IN_BATCH')&&full.some(a=>tabOf(a.category)==='GATE_BLOCKED')).toBe(true);
 });
});

describe('search and filters run on the server across all rows, not only the rows on screen',()=>{
 it('finds a row on a later page by LN, by LN Halos and by the printed code with the Twins suffix',async()=>{
  const last=eligible[READY-CANCELLED-2]; // far down the FIFO list, so it is NOT on page 1 of size 25
  const first=await page({tab:'READY',pageSize:25});expect(first.attempts.some(a=>a.hisLn===last.ln)).toBe(false);
  const byLn=await page({tab:'READY',q:last.ln,pageSize:25});expect(byLn.attempts.map(a=>a.hisLn)).toEqual([last.ln]);expect(byLn.page.total).toBe(1);
  const halos=byLn.attempts[0].lnHalos!;
  expect((await page({tab:'READY',q:halos,pageSize:25})).attempts.map(a=>a.hisLn)).toEqual([last.ln]);
  const row=(await page({tab:'READY',q:twins.ln,pageSize:25})).attempts[0];expect(row.labelCode).toBe(row.lnHalos+'D');
  expect((await page({tab:'READY',q:row.labelCode!,pageSize:25})).attempts.map(a=>a.hisLn)).toEqual([twins.ln]);
  expect((await page({tab:'IN_BATCH',q:row.labelCode!,pageSize:25})).page.total).toBe(0); // not in a Batch
  expect((await page({tab:'READY',q:'zzz-no-match'})).page).toMatchObject({total:0,number:1,totalPages:1});
 });
 it('the same search works in the SQL-paged tabs (Run label, printed sample id, label code with D suffix)',async()=>{
  const all=idsOf(await everyPage('IN_BATCH'));expect(all).toHaveLength(IN_BATCH);
  const rows=(await everyPage('IN_BATCH')).flatMap(d=>d.attempts);const pick=rows.find(r=>r.pregnancy==='Twins')!;
  expect(pick.labelCode).toBe(pick.lnHalos+'D');
  expect((await page({tab:'IN_BATCH',q:pick.labelCode!})).attempts.map(a=>a.attemptId)).toEqual([pick.attemptId]);
  expect((await page({tab:'IN_BATCH',q:pick.printedSampleId!.toLowerCase()})).attempts.map(a=>a.attemptId)).toContain(pick.attemptId);
  expect((await page({tab:'IN_BATCH',q:pick.placement!.runLabel!})).page.total).toBe(IN_BATCH);
  expect((await page({tab:'IN_BATCH',round:'S2'})).page.total).toBe(0);expect((await page({tab:'IN_BATCH',round:'S1'})).page.total).toBe(IN_BATCH);
  expect((await page({tab:'IN_BATCH',pageSize:25,sort:'desc'})).attempts.map(a=>a.attemptId)).toEqual([...rows.map(r=>r.attemptId)].reverse());
 });
 it('urgent-only and unprinted-only filters agree between the Ready (TypeScript) and SQL paths',async()=>{
  const target=eligible[READY-CANCELLED-3];const attempt=(await attemptOf(q(),target.roundId)).id;
  await run(t=>intake.setUrgent(t,u.staff,{attemptId:attempt,urgent:true,reason:'จำลอง แพทย์ขอเร่งด่วน'}));
  const urgent=await page({tab:'READY',urgent:true,pageSize:25});expect(urgent.attempts.map(a=>a.attemptId)).toEqual([attempt]);expect(urgent.attempts[0].urgent).toBe(true);
  const labelled=eligible[15];await run(t=>intake.printLabels(t,u.staff,{roundIds:[labelled.roundId],includeName:false}));
  const unprinted=idsOf(await everyPage('READY',{unprinted:true}));const labelledId=(await attemptOf(q(),labelled.roundId)).id;
  expect(unprinted).not.toContain(labelledId);expect(unprinted.length).toBe((await page({tab:'READY'})).counts.READY-1);
  // urgent is only a badge: it did not change the Ready order (OD-A)
  const expected=await Promise.all(eligible.slice(IN_BATCH,READY-CANCELLED-1).map(async c=>(await attemptOf(q(),c.roundId)).id));
  expect(idsOf(await everyPage('READY'))).toEqual(expected); // same FIFO order as receipt time; the urgent case did not move
 });
});

describe('PHI-access audit covers exactly the cases a response discloses',()=>{
 const logged=async(actor:string)=>(await db.query<{case_id:string}>("SELECT case_id FROM phi_access_log WHERE actor_id=$1 AND purpose='REGISTRY_VIEW'",[actor])).rows.map(r=>r.case_id);
 it('a 100-row page logs 100 cases (the old code stopped at 200 although everything was shown)',async()=>{
  await db.query('DELETE FROM phi_access_log WHERE actor_id=$1',[u.staff.id]).catch(()=>{}); // immutable table: fall back to counting the delta
  const before=(await logged(u.staff.id)).length;
  const d=await page({tab:'READY',pageSize:25});const after=await logged(u.staff.id);
  expect(after.length-before).toBe(d.attempts.length);
  expect(new Set(after.slice(before))).toEqual(new Set(d.attempts.map(a=>a.caseId)));
 });
 it('each page logs its own cases; nothing outside the response is logged; the tabs without rows log nothing',async()=>{
  const start=(await logged(u.staff.id)).length;const p1=await page({tab:'READY',page:1,pageSize:25}),p2=await page({tab:'READY',page:2,pageSize:25});
  const delta=(await logged(u.staff.id)).slice(start);
  expect(delta.length).toBe(p1.attempts.length+p2.attempts.length);
  expect(new Set(delta)).toEqual(new Set([...p1.attempts,...p2.attempts].map(a=>a.caseId)));
  const mark=(await logged(u.staff.id)).length;await page({tab:'IN_BATCH',q:'zzz-no-match'});expect((await logged(u.staff.id)).length).toBe(mark);
 });
 it('a role without worksheet access is refused and logs nothing',async()=>{
  const mark=(await db.query<{n:number}>('SELECT count(*)::int n FROM phi_access_log')).rows[0].n;
  await expect(labWorklistPage(q(),u.anc,{})).rejects.toMatchObject({code:'FORBIDDEN'});
  expect((await db.query<{n:number}>('SELECT count(*)::int n FROM phi_access_log')).rows[0].n).toBe(mark);
 });
});
