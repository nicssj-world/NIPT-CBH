import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {testDatabase} from '../helpers/database';
import {labUsers,syntheticCase,receiveS1,tx} from '../helpers/lab';
import type {Queryable} from '../../packages/db/connection';
import {ancInsights,fiscalMonths} from '../../packages/anc/insights';
import type {Principal} from '../../packages/security/policy';

let db:PGlite,u:Awaited<ReturnType<typeof labUsers>>,other:string;
const q=()=>db as unknown as Queryable;
const c:Record<'high'|'plain'|'otherUnit'|'pending',{caseId:string;roundId:string}>={} as never;
// Wednesday 2026-11-11, 12:00 Bangkok; fiscal year 2570 began on 1 Oct 2026.
const NOW=new Date('2026-11-11T05:00:00Z');
const HIGH={results:{t21:{value:'High Risk',method:'ANCHORED'}}};

async function release(t:Queryable,x:{caseId:string;roundId:string},at:string,parsed:unknown){
 // Fixture only: the certified chain (intake, review, certification) is covered by the P5 suites; here only the released state matters.
 await t.query('SET LOCAL session_replication_role=replica');
 const id=randomUUID();
 await t.query(`INSERT INTO result_report_version(id,intake_file_id,sha256,kind,template_kind,template_version,parser_version,parsed,state,case_id,round_id,attempt_id,link_mode,imported_by) VALUES($1,$2,$3,'RESULT','SINGLETON','SYNTHETIC-v1','SYNTHETIC-v1',$4,'CertifiedReleased',$5,$6,$7,'MANUAL_REVIEWED',$8)`,
  [id,randomUUID(),id.replaceAll('-','').repeat(2),JSON.stringify(parsed),x.caseId,x.roundId,randomUUID(),u.anc.id]);
 await t.query(`INSERT INTO result_release(version_id,case_id,round_id,kind,channel,state,certified_by,certified_at) VALUES($1,$2,$3,'RESULT','NIPT_ANC_VIEW','Active',$4,$5)`,[id,x.caseId,x.roundId,u.anc.id,at]);
}
beforeAll(async()=>{
 db=await testDatabase();u=await labUsers(q());
 other=(await db.query<{id:string}>("INSERT INTO unit(code,name) VALUES('SYNTHETIC_ANC_INSIGHT_2','หน่วยอื่น') RETURNING id")).rows[0].id;
 const make=(unit:string,at:string)=>tx(q(),async t=>{const x=await syntheticCase(t,{staff:u.staff,unit});await receiveS1(t,x,new Date(at),'2026-10-05');return x;});
 c.high=await make(u.unit,'2026-10-05T03:00:00Z');
 c.plain=await make(u.unit,'2026-10-06T03:00:00Z');
 c.otherUnit=await make(other,'2026-10-07T03:00:00Z');
 c.pending=await make(u.unit,'2026-10-08T03:00:00Z');
 await tx(q(),t=>release(t,c.high,'2026-11-05T03:00:00Z',HIGH));
 await tx(q(),t=>release(t,c.plain,'2026-11-09T03:00:00Z',{}));
 await tx(q(),t=>release(t,c.otherUnit,'2026-11-09T03:00:00Z',HIGH));
 // GA at collection (5 Oct) with EDD 1 Feb 2027 = 280-119 = 161 days = 23+0.
 await db.query(`INSERT INTO lab_operational_registration(round_id,case_id,ga_weeks,ga_days,edd,pregnancy,paper_request,paper_consent,input_sha256,actor_id) VALUES($1,$2,0,0,'2027-02-01','Singleton',true,true,$3,$4)`,[c.pending.roundId,c.pending.caseId,'b'.repeat(64),u.staff.id]);
});
afterAll(async()=>{await db?.close();});

describe('ANC overview panel (Owner 2026-11-11)',()=>{
 it('lists only High Risk results, in the nurse units',async()=>{
  const d=await ancInsights(q(),u.anc,{},NOW);
  expect(d.fiscalYear).toBe(2570);
  expect(d.recent).toMatchObject({high:1,total:1});
  expect(d.recent.rows.map(r=>[r.caseId,r.risk])).toEqual([[c.high.caseId,'HIGH']]);
  expect(d.recent.rows.some(r=>r.caseId===c.otherUnit.caseId)).toBe(false);
 });
 it('keeps a High Risk result in the list however long ago it was released',async()=>{
  const d=await ancInsights(q(),u.anc,{},new Date('2026-11-21T05:00:00Z'));
  expect(d.recent.rows.map(r=>r.caseId)).toEqual([c.high.caseId]);
 });
 it('lists cases without a result whose GA at collection is over 18 weeks',async()=>{
  const d=await ancInsights(q(),u.anc,{},NOW);
  expect(d.gaOver18.count).toBe(1);
  expect(d.gaOver18.rows[0]).toMatchObject({caseId:c.pending.caseId,gaWeeks:23,gaDays:0,collectionDate:'2026-10-05',received:true});
 });
 it('monthly statistics of the fiscal year up to this month, in working days',async()=>{
  const d=await ancInsights(q(),u.anc,{},NOW);
  expect(d.monthly.map(m=>m.month)).toEqual(['2026-10','2026-11']);
  expect(d.monthly[0]).toMatchObject({sent:3,released:0,high:0});
  // Received Mon 5 Oct -> released Thu 5 Nov = 23 working days; Tue 6 Oct -> Mon 9 Nov = 24: median 23.5.
  expect(d.monthly[1]).toMatchObject({sent:0,released:2,high:1,medianDays:23.5});
 });
 it('uses the same unit scope as the ANC queue',async()=>{
  await expect(ancInsights(q(),u.anc,{unitId:other},NOW)).rejects.toThrow('FORBIDDEN');
  await expect(ancInsights(q(),u.staff as Principal,{},NOW)).rejects.toThrow('FORBIDDEN');
  await expect(ancInsights(q(),u.anc,{fy:'abc'},NOW)).rejects.toThrow();
 });
 it('fiscal months run October to September and stop at the current month',()=>{
  expect(fiscalMonths(2570,new Date('2027-09-30T05:00:00Z'))).toHaveLength(12);
  expect(fiscalMonths(2569,NOW)).toHaveLength(12);
  expect(fiscalMonths(2570,new Date('2026-10-01T05:00:00Z'))).toEqual(['2026-10']);
 });
});
