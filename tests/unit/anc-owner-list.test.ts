import {afterAll,describe,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {projectionFor,runProjection,type ProjectionInput} from '../../packages/anc/service';
import type {Queryable} from '../../packages/db/connection';
const db=new PGlite();afterAll(()=>db.close());
const facts=`SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid id,('00'||n::text) ln,'00123'::text hn,'ทดสอบ'::text "patientName",ARRAY['unit'] "unitIds",'2026-10-25T00:00:00Z'::timestamptz+n*interval '1 microsecond' "registeredAt",'10000000-0000-4000-8000-000000000001'::uuid "currentRoundId",1 "roundNumber",'Expected'::text "roundState",NULL::timestamptz "s1ReceivedAt",NULL::timestamptz "currentReceivedAt",false "analysisStarted",true "documentsReady",NULL::text "reportState",0 "activeReleaseCount",0 "certifiedReleaseCount",false "consentRevoked",false "identityIssue",n%2=0 redraw,false repeat,n%3=0 hold,n=1 urgent FROM generate_series(1,25) n WHERE cardinality($1::uuid[])>=0`;
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
 it('counts all six tabs over the full filtered set, independently of selected tab and page',async()=>{
  const a=await run({tab:'hold',limit:2});
  expect(a.total).toBe(8);expect(a.rows).toHaveLength(2);
  expect(a.tab_counts).toEqual({all:25,pending:0,released:0,attention:17,redraw:12,hold:8});
  const b=await run({q:'0025',tab:'hold'});
  expect(b.total).toBe(0);expect(b.tab_counts).toEqual({all:1,pending:0,released:0,attention:0,redraw:0,hold:0});
  const c=await run({unitId:'unauthorized'});expect(c.tab_counts.all).toBe(0);
 });
});
