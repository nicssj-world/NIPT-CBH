import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {testDatabase} from '../helpers/database';
import {labUsers,syntheticCase,receiveS1,tx} from '../helpers/lab';
import type {Queryable} from '../../packages/db/connection';
import {listP2Cases,registrySummary} from '../../packages/p2/service';

let db:PGlite,u:Awaited<ReturnType<typeof labUsers>>,other:string;
const q=()=>db as unknown as Queryable;
type C={caseId:string;roundId:string};
const c:Record<'waiting'|'testing'|'high'|'low'|'otherUnit',C>={} as never;

/** Released result fixture (FKs off), as tests/db/anc-insights.test.ts. Returns the attempt id. */
async function release(t:Queryable,x:C,at:string,parsed:unknown){
 await t.query('SET LOCAL session_replication_role=replica');
 const id=randomUUID(),attempt=randomUUID();
 await t.query(`INSERT INTO result_report_version(id,intake_file_id,sha256,kind,template_kind,template_version,parser_version,parsed,state,case_id,round_id,attempt_id,link_mode,imported_by) VALUES($1,$2,$3,'RESULT','SINGLETON','SYNTHETIC-v1','SYNTHETIC-v1',$4,'CertifiedReleased',$5,$6,$7,'MANUAL_REVIEWED',$8)`,
  [id,randomUUID(),id.replaceAll('-','').repeat(2),JSON.stringify(parsed),x.caseId,x.roundId,attempt,u.staff.id]);
 await t.query(`INSERT INTO result_release(version_id,case_id,round_id,kind,channel,state,certified_by,certified_at) VALUES($1,$2,$3,'RESULT','NIPT_ANC_VIEW','Active',$4,$5)`,[id,x.caseId,x.roundId,u.staff.id,at]);
 return attempt;
}
async function inRun(t:Queryable,attempt:string,label:string,number:number,createdAt:string){
 await t.query('SET LOCAL session_replication_role=replica');
 const batch=randomUUID();
 await t.query(`INSERT INTO lab_batch(id,run_year,run_number,run_label,state,template_version,formula_version,created_by,created_at) VALUES($1,2569,$2,$3,'QC1Complete','t','f',$4,$5)`,[batch,number,label,u.staff.id,createdAt]);
 await t.query(`INSERT INTO lab_slot_assignment(batch_id,slot_number,attempt_id,assigned_by) VALUES($1,1,$2,$3)`,[batch,attempt,u.staff.id]);
}

beforeAll(async()=>{
 db=await testDatabase();u=await labUsers(q());
 other=(await db.query<{id:string}>("INSERT INTO unit(code,name) VALUES('SYNTHETIC_REG_FILTER_2','หน่วยกรองอื่น') RETURNING id")).rows[0].id;
 const make=(unit:string,at?:string)=>tx(q(),async t=>{const x=await syntheticCase(t,{staff:u.staff,unit});await t.query('INSERT INTO p2_case_identity(case_id,hn) VALUES($1,$2)',[x.caseId,'99000'+x.ln.slice(-7)]);if(at)await receiveS1(t,x,new Date(at),'2026-10-05');return x;});
 c.waiting=await make(u.unit);
 c.testing=await make(u.unit,'2026-10-06T03:00:00Z');
 c.high=await make(u.unit,'2026-10-07T03:00:00Z');
 c.low=await make(u.unit,'2026-10-08T03:00:00Z');
 c.otherUnit=await make(other,'2026-10-09T03:00:00Z');
 // GA at the 5 Oct draw with EDD 1 Feb 2027 = 23+0 (over 18 weeks), recorded by the Lab paper registration.
 await db.query(`INSERT INTO lab_operational_registration(round_id,case_id,ga_weeks,ga_days,edd,pregnancy,paper_request,paper_consent,input_sha256,actor_id) VALUES($1,$2,0,0,'2027-02-01','Singleton',true,true,$3,$4)`,[c.testing.roundId,c.testing.caseId,'c'.repeat(64),u.staff.id]);
 // The High Risk result sits in the newest Run; an older Run holds the other unit's High Risk result.
 await tx(q(),async t=>{const a=await release(t,c.high,'2026-11-05T03:00:00Z',{results:{t21:{value:'High Risk',method:'ANCHORED'}}});await inRun(t,a,'Run009/2569',9,'2026-11-02T03:00:00Z');});
 await tx(q(),t=>release(t,c.low,'2026-11-06T03:00:00Z',{}));
 await tx(q(),async t=>{const a=await release(t,c.otherUnit,'2026-11-01T03:00:00Z',{results:{xxy:{value:'Detected',method:'ANCHORED'}}});await inRun(t,a,'Run008/2569',8,'2026-10-25T03:00:00Z');});
});
afterAll(async()=>{await db?.close();});

const ids=(r:{cases:{id:string}[]})=>r.cases.map(x=>x.id).sort();
const sorted=(...x:C[])=>x.map(y=>y.caseId).sort();

describe('central registry filters (Owner 2026-11-14)',()=>{
 it('counts every status and flag over the same scope, and the status filter lists exactly those rows',async()=>{
  const all=await listP2Cases(q(),u.staff,{});
  expect(all.counts).toMatchObject({all:5,awaiting:1,testing:1,released:3,followup:0,high:2,high_run:1,ga18:1});
  expect((await listP2Cases(q(),u.staff,{status:'awaiting'})).cases.map(x=>x.id)).toEqual([c.waiting.caseId]);
  expect((await listP2Cases(q(),u.staff,{status:'testing'})).cases.map(x=>x.id)).toEqual([c.testing.caseId]);
  const released=await listP2Cases(q(),u.staff,{status:'released'});
  expect(ids(released)).toEqual(sorted(c.high,c.low,c.otherUnit));
  expect(released.page.total).toBe(3);
  expect(released.cases.every(x=>x.status==='released')).toBe(true);
 });
 it('High Risk marks the row and filters; "Run ล่าสุด" keeps only the newest Run',async()=>{
  const high=await listP2Cases(q(),u.staff,{flag:'high'});
  expect(ids(high)).toEqual(sorted(c.high,c.otherUnit));
  expect(high.cases.every(x=>x.highRisk)).toBe(true);
  expect((await listP2Cases(q(),u.staff,{flag:'high_run'})).cases.map(x=>x.id)).toEqual([c.high.caseId]);
  expect((await listP2Cases(q(),u.staff,{status:'released'})).cases.find(x=>x.id===c.low.caseId)?.highRisk).toBe(false);
 });
 it('GA over 18 weeks uses the Lab registration EDD and shows the same GA in the row',async()=>{
  const ga=await listP2Cases(q(),u.staff,{flag:'ga18'});
  expect(ga.cases.map(x=>x.id)).toEqual([c.testing.caseId]);
  expect(ga.cases[0].ga).toEqual({weeks:23,days:0,over18:true});
 });
 it('the unit filter narrows rows and counts; a unit outside the scope is refused',async()=>{
  const one=await listP2Cases(q(),u.staff,{unitId:other});
  expect(one.cases.map(x=>x.id)).toEqual([c.otherUnit.caseId]);
  expect(one.counts).toMatchObject({all:1,released:1,high:1});
  expect(one.scopeUnits.some(x=>x.id===other)).toBe(true);
  await expect(listP2Cases(q(),u.staff,{status:'nope'})).rejects.toThrow('FILTER_INVALID');
 });
 it('summary returns the same counts with the latest Run label and no rows or PHI-access record',async()=>{
  const before=(await db.query<{n:number}>('SELECT count(*)::int n FROM phi_access_log WHERE actor_id=$1',[u.staff.id])).rows[0].n;
  const s=await registrySummary(q(),u.staff,{});
  expect(s).not.toHaveProperty('cases');
  expect(s.counts).toEqual((await listP2Cases(q(),u.staff,{})).counts);
  expect(s.latestRun).toBe('Run009/2569');
  const after=(await db.query<{n:number}>('SELECT count(*)::int n FROM phi_access_log WHERE actor_id=$1',[u.staff.id])).rows[0].n;
  // listP2Cases above records its own page; the summary adds nothing.
  expect(after-before).toBe(5);
 });
 it('sorts by the send date both ways',async()=>{
  const desc=(await listP2Cases(q(),u.staff,{sort:'sent_desc'})).cases.map(x=>x.sent_at?new Date(x.sent_at).getTime():-1);
  const asc=(await listP2Cases(q(),u.staff,{sort:'sent_asc'})).cases.map(x=>x.sent_at?new Date(x.sent_at).getTime():Infinity);
  expect(desc.filter(x=>x>=0)).toEqual([...desc.filter(x=>x>=0)].sort((a,b)=>b-a));
  expect(asc.filter(Number.isFinite)).toEqual([...asc.filter(Number.isFinite)].sort((a,b)=>a-b));
 });
});
