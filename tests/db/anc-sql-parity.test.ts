import {describe,expect,it,beforeAll,afterAll} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import type {Queryable} from '../../packages/db/connection';
import {testDatabase,addUser} from '../helpers/database';
import {syntheticCase,receiveS1,tx} from '../helpers/lab';
import {dashboard,projectionFor,runProjection,type Cursor} from '../../packages/anc/service';
import {project,matches,stages,type CaseFacts,type Filters} from '../../packages/anc/model';
import type {Principal} from '../../packages/security/policy';

// The ANC dashboard now filters, counts, orders and pages in SQL. model.ts (project/matches) remains the reference definition, so this runs
// BOTH over the same facts: a few hundred generated combinations that reach every stage, flag and KPI, and every filter combination.
const U1='11111111-1111-4111-8111-111111111111',U2='22222222-2222-4222-8222-222222222222';
const uuid=(n:number)=>`00000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
let seed=20261019;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32;};
const pick=<T,>(a:readonly T[])=>a[Math.floor(rnd()*a.length)];
const chance=(p:number)=>rnd()<p;
// Receipt instants cluster around the Bangkok fiscal-year boundary (30 Sep 17:00Z = 1 Oct 00:00 Bangkok) and around "now".
const instants=['2024-09-30T16:59:59Z','2024-09-30T17:00:00Z','2025-10-12T03:00:00Z','2026-01-05T01:30:00Z','2026-09-30T16:59:59Z','2026-09-30T17:00:00Z','2026-10-12T00:00:00Z','2026-10-16T09:00:00Z','2026-10-17T02:59:59Z'];
const NOW=new Date('2026-10-17T03:00:00Z');
function generate(n:number):CaseFacts[]{
 return Array.from({length:n},(_,i)=>{
  const s1=chance(.75)?pick(instants):null,round=chance(.05)?null:uuid(10000+i);
  return {id:uuid(i+1),ln:`0099${String(i).padStart(7,'0')}`,hn:chance(.7)?`99${String(i*7).padStart(8,'0')}`:null,patientName:i%3===0?'นางสาว ทดสอบ':null,unitIds:pick([[U1],[U2],[U1,U2]]),currentRoundId:round,roundNumber:pick([1,1,2,3]),
   roundState:pick(['Expected','ReceivedInHIS','ReceivedInNIPT','Completed','RedrawRequested']),s1ReceivedAt:s1,currentReceivedAt:chance(.8)?(s1&&chance(.8)?s1:pick(instants)):null,analysisStarted:chance(.3),documentsReady:chance(.6),
   reportState:pick([null,null,'Unlinked','Linked','ValidationBlocked','PendingCertification','CertifiedReleased']),activeReleaseCount:pick([0,0,0,1,1,2]),certifiedReleaseCount:pick([0,0,1,1,2]),
   redraw:chance(.15),repeat:chance(.15),hold:chance(.15),urgent:chance(.15),consentRevoked:chance(.1),identityIssue:chance(.1)};});
}
const fixtureFacts=(facts:CaseFacts[])=>`SELECT t.id,t.ln,t.hn,t."patientName",ARRAY(SELECT json_array_elements_text(t."unitIds"))::text[] "unitIds",t."currentRoundId",t."roundNumber",t."roundState",t."s1ReceivedAt",t."currentReceivedAt",t."analysisStarted",t."documentsReady",t."reportState",t."activeReleaseCount",t."certifiedReleaseCount",t."consentRevoked",t."identityIssue",t.redraw,t.repeat,t.hold,t.urgent
 FROM json_to_recordset('${JSON.stringify(facts)}'::json) AS t(id uuid,ln text,hn text,"patientName" text,"unitIds" json,"currentRoundId" uuid,"roundNumber" int,"roundState" text,"s1ReceivedAt" timestamptz,"currentReceivedAt" timestamptz,"analysisStarted" boolean,"documentsReady" boolean,"reportState" text,"activeReleaseCount" int,"certifiedReleaseCount" int,"consentRevoked" boolean,"identityIssue" boolean,redraw boolean,repeat boolean,hold boolean,urgent boolean)
 WHERE cardinality($1::uuid[])>=0`;
const order=(a:{urgent:boolean;daysWaiting:number|null;id:string},b:{urgent:boolean;daysWaiting:number|null;id:string})=>Number(b.urgent)-Number(a.urgent)||(b.daysWaiting??-1)-(a.daysWaiting??-1)||a.id.localeCompare(b.id);
const FILTERS:Partial<Filters>[]=[{},{kpi:'pending'},{kpi:'sent'},{kpi:'released'},{kpi:'attention'},{stage:'exception'},{stage:'review'},{stage:'documents'},{flag:'hold'},{flag:'documents'},{flag:'unmapped_state'},{flag:'conflicting_release'},{flag:'missing_s1'},{tab:'redraw'},{tab:'hold'},{tab:'pending'},{tab:'released'},{tab:'attention'},{unitId:U1},{unitId:U2,kpi:'pending'},{q:'0099000'},{q:'0099000012'},{q:'00-990-0-0012'},{q:'99'},{q:'ทดสอบ'},{kpi:'pending',flag:'urgent',unitId:U2},{tab:'hold',stage:'received',q:'1'},{q:'zzz-no-match'}];

describe('ANC SQL projection is the model.ts projection',()=>{
 const facts=generate(450);
 const items=facts.map(f=>project(f,NOW));
 const sql=projectionFor(fixtureFacts(facts)),FY=2570;
 let db:PGlite;beforeAll(()=>{db=new PGlite();});afterAll(async()=>{await db.close();});
 for(const [n,filter] of FILTERS.entries())it(`filter #${n} ${JSON.stringify(filter)}: total, KPIs, stage counts, order and every item field match`,async()=>{
  const scoped=items.filter(c=>matches(c,{unitId:filter.unitId}));
  const expected=scoped.filter(c=>matches(c,{...filter,fy:FY})).sort(order);
  const run=(limit:number,offset:number,cursor:Cursor|null=null)=>runProjection(db as unknown as Queryable,sql,{unitIds:[U1,U2],asOf:NOW,fy:FY,unitId:filter.unitId,kpi:filter.kpi,stage:filter.stage,flag:filter.flag,tab:filter.tab??'all',q:filter.q??'',cursor,limit,offset});
  const first=await run(100,0);
  expect(first.total).toBe(expected.length);
  for(const k of ['sent','pending','released','attention'] as const)expect(first.metrics[k],k).toBe(scoped.filter(c=>matches(c,{kpi:k,fy:FY})).length);
  for(const [id] of stages)expect(first.stage_counts[id]??0,id).toBe(scoped.filter(c=>c.stage===id).length);
  // OFFSET walk
  const walked=[];for(let o=0;o<expected.length;o+=100)walked.push(...(await run(100,o)).rows);
  expect(walked.map(r=>r.id)).toEqual(expected.map(c=>c.id));
  for(const [i,row] of walked.entries()){const e=expected[i];expect({stage:row.stage,flags:row.flags,released:row.released,pending:row.pending,daysWaiting:row.daysWaiting,urgent:row.urgent,hold:row.hold,unitIds:row.unitIds,documentsReady:row.documentsReady})
   .toEqual({stage:e.stage,flags:e.flags,released:e.released,pending:e.pending,daysWaiting:e.daysWaiting,urgent:e.urgent,hold:e.hold,unitIds:e.unitIds,documentsReady:e.documentsReady});}
  // keyset walk with an awkward page size reaches the same rows in the same order, each exactly once
  const seen:string[]=[];let cursor:Cursor|null=null;for(;;){const page=await run(7,0,cursor);if(!page.rows.length)break;seen.push(...page.rows.map(r=>r.id));const last=page.rows.at(-1)!;cursor={u:last.ord_u as 0|1,d:last.ord_d,id:last.id};if(page.rows.length<7)break;}
  expect(seen).toEqual(expected.map(c=>c.id));
 },60000);
 it('the generated facts really reach every stage and every flag (the comparison is not vacuous)',()=>{
  expect(new Set(items.map(c=>c.stage))).toEqual(new Set(stages.map(s=>s[0])));
  const flags=new Set(items.flatMap(c=>c.flags));for(const f of ['redraw','repeat','hold','urgent','consent_revoked','identity_issue','documents','missing_s1','conflicting_release','validation_blocked','unmapped_state'])expect(flags.has(f as never),f).toBe(true);
 });
});

describe('ANC dashboard paging on a real database',()=>{
 let db:PGlite,anc:Principal,unit:string;
 const principal=()=>({...anc,unitIds:[unit]});
 beforeAll(async()=>{
  db=await testDatabase();anc=await addUser(db,'ANC_NURSE','synthetic.anc.paging');
  unit=(await db.query<{id:string}>("INSERT INTO unit(code,name) VALUES('ANC-PAGE-1','ANC paging') RETURNING id")).rows[0].id;anc={...anc,unitIds:[unit]};
  for(let i=0;i<25;i++){await tx(db as unknown as Queryable,async()=>{const c=await syntheticCase(db as unknown as Queryable,{staff:anc,unit});await receiveS1(db as unknown as Queryable,c,new Date(Date.UTC(2026,8,1)+i*3600000));});}
 });
 afterAll(async()=>{await db?.close();});
 it('offset paging reaches every case once and totals/pages are exact; an empty search is "page 1 of 1"',async()=>{
  const all:string[]=[];let page=1,totalPages=1;
  do{const d=await dashboard(db as unknown as Queryable,principal(),{fy:2570,page,pageSize:10});expect(d.queue.total).toBe(25);totalPages=d.queue.totalPages;expect(d.queue.items.length).toBe(page<3?10:5);all.push(...d.queue.items.map(c=>c.id));page++;}while(page<=totalPages);
  expect(totalPages).toBe(3);expect(new Set(all).size).toBe(25);
  const none=await dashboard(db as unknown as Queryable,principal(),{q:'no-such-ln'});expect(none.queue).toMatchObject({total:0,page:1,totalPages:1,items:[],nextCursor:null});
  const beyond=await dashboard(db as unknown as Queryable,principal(),{page:99,pageSize:10});expect(beyond.queue.page).toBe(3);expect(beyond.queue.items).toHaveLength(5);
 });
 it('a case that jumps to the top between page 1 and page 2 cannot repeat a row when following the cursor; offset paging would',async()=>{
  const first=await dashboard(db as unknown as Queryable,principal(),{pageSize:10});
  const shown=new Set(first.queue.items.map(c=>c.id));expect(first.queue.nextCursor).toBeTruthy();
  // an urgent case sorts first: insert one more urgent case after page 1 was read
  const c=await tx(db as unknown as Queryable,async()=>{const x=await syntheticCase(db as unknown as Queryable,{staff:anc,unit});await receiveS1(db as unknown as Queryable,x,new Date(Date.UTC(2026,8,10)));return x;});
  const attempt=(await db.query<{id:string}>('SELECT id FROM analytical_attempt WHERE round_id=$1',[c.roundId])).rows[0].id;
  await db.query("INSERT INTO attempt_event(attempt_id,case_id,event_type,reason,actor_id) VALUES($1,$2,'URGENT_SET','SYNTHETIC urgent after page one',$3)",[attempt,c.caseId,anc.id]);
  const byCursor=await dashboard(db as unknown as Queryable,principal(),{pageSize:10,after:first.queue.nextCursor!,asOf:first.asOf});
  expect(byCursor.queue.items.some(i=>shown.has(i.id))).toBe(false);
  const byOffset=await dashboard(db as unknown as Queryable,principal(),{pageSize:10,page:2});
  expect(byOffset.queue.items.some(i=>shown.has(i.id))).toBe(true); // the failure mode the cursor exists to prevent
  expect(byCursor.queue.total).toBe(26);
 });
 it('rejects a forged cursor and an invalid page size',async()=>{
  await expect(dashboard(db as unknown as Queryable,principal(),{after:'not-a-cursor'})).rejects.toMatchObject({code:'INVALID_CURSOR'});
  await expect(dashboard(db as unknown as Queryable,principal(),{pageSize:101})).rejects.toThrow();
  await expect(dashboard(db as unknown as Queryable,principal(),{page:0})).rejects.toThrow();
 });
});
