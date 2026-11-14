import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {testDatabase} from '../helpers/database';
import {labUsers,syntheticCase,receiveS1,tx} from '../helpers/lab';
import type {Queryable} from '../../packages/db/connection';
import {ancInsights,fiscalMonths,ageGroups} from '../../packages/anc/insights';
import type {Principal} from '../../packages/security/policy';

let db:PGlite,u:Awaited<ReturnType<typeof labUsers>>,other:string;
const q=()=>db as unknown as Queryable;
const c:Record<'high'|'plain'|'otherUnit'|'pending',{caseId:string;roundId:string}>={} as never;
// Wednesday 2026-11-11, 12:00 Bangkok; fiscal year 2570 began on 1 Oct 2026.
const NOW=new Date('2026-11-11T05:00:00Z');
const HIGH={results:{t21:{value:'High Risk',method:'ANCHORED'}}};

/** Puts the attempt of a release into a Run (fixture only; FKs off like the release itself). */
async function inRun(t:Queryable,attempt:string,label:string,year:number,number:number,createdAt:string){
 await t.query('SET LOCAL session_replication_role=replica');
 const batch=randomUUID();
 await t.query(`INSERT INTO lab_batch(id,run_year,run_number,run_label,state,template_version,formula_version,created_by,created_at) VALUES($1,$2,$3,$4,'QC1Complete','t','f',$5,$6)`,[batch,year,number,label,u.anc.id,createdAt]);
 await t.query(`INSERT INTO lab_slot_assignment(batch_id,slot_number,attempt_id,assigned_by) VALUES($1,1,$2,$3)`,[batch,attempt,u.anc.id]);
}
async function release(t:Queryable,x:{caseId:string;roundId:string},at:string,parsed:unknown){
 // Fixture only: the certified chain (intake, review, certification) is covered by the P5 suites; here only the released state matters.
 await t.query('SET LOCAL session_replication_role=replica');
 const id=randomUUID(),attempt=randomUUID();
 await t.query(`INSERT INTO result_report_version(id,intake_file_id,sha256,kind,template_kind,template_version,parser_version,parsed,state,case_id,round_id,attempt_id,link_mode,imported_by) VALUES($1,$2,$3,'RESULT','SINGLETON','SYNTHETIC-v1','SYNTHETIC-v1',$4,'CertifiedReleased',$5,$6,$7,'MANUAL_REVIEWED',$8)`,
  [id,randomUUID(),id.replaceAll('-','').repeat(2),JSON.stringify(parsed),x.caseId,x.roundId,attempt,u.anc.id]);
 await t.query(`INSERT INTO result_release(version_id,case_id,round_id,kind,channel,state,certified_by,certified_at) VALUES($1,$2,$3,'RESULT','NIPT_ANC_VIEW','Active',$4,$5)`,[id,x.caseId,x.roundId,u.anc.id,at]);
 return attempt;
}
beforeAll(async()=>{
 db=await testDatabase();u=await labUsers(q());
 other=(await db.query<{id:string}>("INSERT INTO unit(code,name) VALUES('SYNTHETIC_ANC_INSIGHT_2','หน่วยอื่น') RETURNING id")).rows[0].id;
 const make=(unit:string,at:string)=>tx(q(),async t=>{const x=await syntheticCase(t,{staff:u.staff,unit});await receiveS1(t,x,new Date(at),'2026-10-05');return x;});
 c.high=await make(u.unit,'2026-10-05T03:00:00Z');
 c.plain=await make(u.unit,'2026-10-06T03:00:00Z');
 c.otherUnit=await make(other,'2026-10-07T03:00:00Z');
 c.pending=await make(u.unit,'2026-10-08T03:00:00Z');
 // The High Risk case sits in Run002 (latest); an older Run001 holds another High Risk result that must not be counted.
 await tx(q(),async t=>{const a=await release(t,c.high,'2026-11-05T03:00:00Z',HIGH);await inRun(t,a,'Run002/2569',2569,2,'2026-11-02T03:00:00Z');});
 await tx(q(),t=>release(t,c.plain,'2026-11-09T03:00:00Z',{}));
 await tx(q(),async t=>{const a=await release(t,c.otherUnit,'2026-11-09T03:00:00Z',HIGH);await inRun(t,a,'Run001/2569',2569,1,'2026-10-20T03:00:00Z');});
 // GA at collection (5 Oct) with EDD 1 Feb 2027 = 280-119 = 161 days = 23+0.
 await db.query(`INSERT INTO lab_operational_registration(round_id,case_id,ga_weeks,ga_days,edd,pregnancy,paper_request,paper_consent,input_sha256,actor_id) VALUES($1,$2,0,0,'2027-02-01','Singleton',true,true,$3,$4)`,[c.pending.roundId,c.pending.caseId,'b'.repeat(64),u.staff.id]);
});
afterAll(async()=>{await db?.close();});

describe('ANC overview panel (Owner 2026-11-11)',()=>{
 it('counts and lists the High Risk results of the latest Run only, in the nurse units',async()=>{
  const d=await ancInsights(q(),u.anc,{},NOW);
  expect(d.fiscalYear).toBe(2570);
  expect(d.highRisk).toMatchObject({count:1,runLabel:'Run002/2569'});
  expect(d.highRisk!.rows.map(r=>r.caseId)).toEqual([c.high.caseId]);
  expect(d.highRisk!.rows.some(r=>r.caseId===c.otherUnit.caseId)).toBe(false);
 });
 it('keeps a High Risk result of the latest Run however long ago it was released',async()=>{
  const d=await ancInsights(q(),u.anc,{},new Date('2026-11-21T05:00:00Z'));
  expect(d.highRisk!.rows.map(r=>r.caseId)).toEqual([c.high.caseId]);
 });
 it('lists cases without a result whose GA at collection is over 18 weeks',async()=>{
  const d=await ancInsights(q(),u.anc,{},NOW);
  expect(d.gaOver18!.count).toBe(1);
  expect(d.gaOver18!.rows[0]).toMatchObject({caseId:c.pending.caseId,gaWeeks:23,gaDays:0,collectionDate:'2026-10-05',received:true});
 });
 it('monthly statistics of the fiscal year up to this month, in working days',async()=>{
  const d=await ancInsights(q(),u.anc,{},NOW);
  expect(d.monthly.map(m=>m.month)).toEqual(['2026-10','2026-11']);
  expect(d.monthly[0]).toMatchObject({sent:3,released:0,high:0});
  // Received Mon 5 Oct -> released Thu 5 Nov = 23 working days; Tue 6 Oct -> Mon 9 Nov = 24: median 23.5.
  expect(d.monthly[1]).toMatchObject({sent:0,released:2,high:1,medianDays:23.5});
 });
 it('Dashboard: the last 14 days, and no names in view=dashboard (Owner 2026-11-14)',async()=>{
  const d=await ancInsights(q(),u.anc,{view:'dashboard'},NOW);
  expect(d.recent.map(x=>x.day)).toHaveLength(14);
  expect(d.recent[0].day).toBe('2026-10-29');expect(d.recent.at(-1)!.day).toBe('2026-11-11');
  expect(d.recent.find(x=>x.day==='2026-11-05')).toMatchObject({released:1});
  expect(d.recent.find(x=>x.day==='2026-11-09')).toMatchObject({released:1});
  expect(d.recent.reduce((n,x)=>n+x.sent,0)).toBe(0);
  expect(d.highRisk).toBeNull();expect(d.gaOver18).toBeNull();
 });
 it('uses the same unit scope as the ANC queue',async()=>{
  await expect(ancInsights(q(),u.anc,{unitId:other},NOW)).rejects.toThrow('FORBIDDEN');
  await expect(ancInsights(q(),u.staff as Principal,{},NOW)).rejects.toThrow('FORBIDDEN');
  await expect(ancInsights(q(),u.anc,{fy:'abc'},NOW)).rejects.toThrow();
 });
 it('splits High Risk into chromosomes 13/18/21 and the sex chromosomes (Owner 2026-11-14)',async()=>{
  // Runs last among the monthly checks: adds a sex-chromosome High Risk result in November.
  const sca=await tx(q(),async t=>{const x=await syntheticCase(t,{staff:u.staff,unit:u.unit});await receiveS1(t,x,new Date('2026-10-09T03:00:00Z'),'2026-10-05');return x;});
  await tx(q(),t=>release(t,sca,'2026-11-10T03:00:00Z',{results:{xxy:{value:'Detected',method:'ANCHORED'}}}));
  const d=await ancInsights(q(),u.anc,{},NOW);
  expect(d.monthly[1]).toMatchObject({released:3,high:2,highTrisomy:1,highSca:1});
  expect(d.stats.totals).toMatchObject({high:2,highTrisomy:1,highSca:1});
  // By finding (Owner 2026-11-14): the T21 result and the XXY result; nothing else.
  expect(d.stats.positive).toEqual({t13:0,t18:0,t21:1,xo:0,xxx:0,xxy:1,xyy:0});
 });
 it('maternal age bands of the cases sent (Owner 2026-11-14)',async()=>{
  // Birth date from the ANC request (no matched PET): born 20 Oct 1990, first draw 5 Oct 2026 -> 35 years; the other cases have no birth date.
  await db.query("INSERT INTO p2_workspace(case_id,round_id,version,draft,request_mode,consent_mode,updated_by) VALUES($1,$2,0,$3,'Paper','Paper',$4)",[c.high.caseId,c.high.roundId,JSON.stringify({patient:{syntheticName:'SYNTHETIC-AGE',dob:'1990-10-20'}}),u.anc.id]);
  const d=await ancInsights(q(),u.anc,{},NOW);
  expect(d.stats.age.groups.find(g=>g.label==='35–39 ปี')).toMatchObject({sent:1,high:1});
  expect(d.stats.age).toMatchObject({known:1,over35:1,median:35});
  const sent=d.stats.age.groups.reduce((n,g)=>n+g.sent,0)+d.stats.age.unknown;
  expect(sent).toBe(d.stats.totals.sent);
  const g=ageGroups([{age:19,high:false},{age:20,high:false},{age:34,high:true},{age:35,high:true},{age:42,high:false},{age:null,high:true},{age:3,high:false}]);
  expect(g.groups.map(x=>[x.sent,x.high])).toEqual([[1,0],[1,0],[0,0],[1,1],[1,1],[1,0]]);
  expect(g).toMatchObject({known:5,unknown:2,unknownHigh:1,over35:2,median:34});
 });
 it('fiscal months run October to September and stop at the current month',()=>{
  expect(fiscalMonths(2570,new Date('2027-09-30T05:00:00Z'))).toHaveLength(12);
  expect(fiscalMonths(2569,NOW)).toHaveLength(12);
  expect(fiscalMonths(2570,new Date('2026-10-01T05:00:00Z'))).toEqual(['2026-10']);
 });
});
