import {afterAll,describe,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {projectionFor,runProjection,type ProjectionInput} from '../../packages/anc/service';
import type {Queryable} from '../../packages/db/connection';
const db=new PGlite();afterAll(()=>db.close());
const facts=`SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid id,('00'||n::text) ln,'00123'::text hn,'ทดสอบ'::text "patientName",ARRAY['unit'] "unitIds",'2026-10-25T00:00:00Z'::timestamptz+n*interval '1 microsecond' "registeredAt",'10000000-0000-4000-8000-000000000001'::uuid "currentRoundId",1 "roundNumber",'Expected'::text "roundState",NULL::timestamptz "s1ReceivedAt",NULL::timestamptz "currentReceivedAt",false "analysisStarted",true "documentsReady",NULL::text "reportState",0 "activeReleaseCount",0 "certifiedReleaseCount",false "historicalResult",false "consentRevoked",false "identityIssue",n%2=0 redraw,false repeat,n%3=0 hold,n=1 urgent FROM generate_series(1,25) n WHERE cardinality($1::uuid[])>=0`;
const sql=projectionFor(facts,true);
const input:ProjectionInput={unitIds:[],asOf:new Date('2026-10-25T03:00:00Z'),fy:2570,tab:'all',q:'',cursor:null,limit:10,offset:0};
const run=(patch:Partial<ProjectionInput>={})=>runProjection(db as unknown as Queryable,sql,{...input,...patch});
describe('Owner ANC queue ordering and full filtered tab counts',()=>{
 it('orders by registration microseconds, newest first, across cursor pages regardless of urgency',async()=>{
  const a=await run(),last=a.rows.at(-1)!;
  expect(a.rows[0].ln).toBe('0025');
  const b=await run({cursor:{u:0,d:Number(last.ord_d),id:last.id}});
  expect(b.rows[0].ln).toBe('0015');expect(new Set([...a.rows,...b.rows].map(r=>r.id)).size).toBe(20);
 });
 it('counts all nine tabs over the full filtered set, independently of selected tab and page',async()=>{
  const a=await run({tab:'hold',limit:2});
  expect(a.total).toBe(8);expect(a.rows).toHaveLength(2);
  expect(a.tab_counts).toEqual({all:25,pending:0,released:0,attention:17,redraw:12,hold:8,awaiting:13,testing:0,followup:12});   // stage groups: 13+0+12 = all 25
  const b=await run({q:'0025',tab:'hold'});
  expect(b.total).toBe(0);expect(b.tab_counts).toEqual({all:1,pending:0,released:0,attention:0,redraw:0,hold:0,awaiting:1,testing:0,followup:0});
  const c=await run({unitId:'unauthorized'});expect(c.tab_counts.all).toBe(0);
 });
});
describe('Owner ANC queue: sort by first receipt (Owner 2026-11-12)',()=>{
 // n%6=0 has no receipt; the rest are received on one of five days, so ties occur and must stay stable across cursor pages.
 const facts2=facts.replace(`NULL::timestamptz "s1ReceivedAt"`,`CASE WHEN n%6=0 THEN NULL ELSE '2026-10-01T02:00:00Z'::timestamptz+(n%5)*interval '1 day' END "s1ReceivedAt"`);
 const sql2=projectionFor(facts2,true);
 const walk=async(sort:string)=>{const seen:{id:string;at:string|null}[]=[];let cursor:ProjectionInput['cursor']=null;
  for(;;){const page=await runProjection(db as unknown as Queryable,sql2,{...input,sort,limit:4,cursor});seen.push(...page.rows.map(r=>({id:r.id,at:r.s1ReceivedAt})));if(page.rows.length<4)break;const last=page.rows.at(-1)!;cursor={u:0,d:Number(last.ord_d),id:last.id};}
  return seen;};
 for(const sort of ['received_desc','received_asc'] as const)it(`${sort}: every case once, receipts in order, cases without a receipt last`,async()=>{
  const seen=await walk(sort);
  expect(new Set(seen.map(s=>s.id)).size).toBe(25);expect(seen).toHaveLength(25);
  const firstNull=seen.findIndex(s=>s.at===null);expect(firstNull).toBe(25-4);expect(seen.slice(firstNull).every(s=>s.at===null)).toBe(true);
  const times=seen.slice(0,firstNull).map(s=>Date.parse(s.at!));
  expect(times).toEqual([...times].sort((a,b)=>sort==='received_desc'?b-a:a-b));
 });
 it('without a sort the queue stays newest registration first',async()=>{
  const a=await runProjection(db as unknown as Queryable,sql2,{...input});expect(a.rows[0].ln).toBe('0025');
 });
});
