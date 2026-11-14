import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {testDatabase} from '../helpers/database';
import {labUsers,syntheticCase,receiveS1,tx} from '../helpers/lab';
import type {Queryable} from '../../packages/db/connection';
import {labOverview,labStage,lastMonths} from '../../packages/lab/overview';
import type {Principal} from '../../packages/security/policy';

let db:PGlite,u:Awaited<ReturnType<typeof labUsers>>;
const q=()=>db as unknown as Queryable;
const ids:Record<'late'|'soon'|'fresh',{caseId:string;roundId:string}>={} as never;
// Wednesday 2026-11-11, 12:00 Bangkok.
const NOW=new Date('2026-11-11T05:00:00Z');

beforeAll(async()=>{
 db=await testDatabase();u=await labUsers(q());
 const make=async(at:string,edd?:string)=>tx(q(),async t=>{const c=await syntheticCase(t,{staff:u.staff,unit:u.unit});await receiveS1(t,c,new Date(at),'2026-10-10');
  // EDD as the Lab paper registration records it (p2_paper_review is append-only and its panel has no EDD here).
  if(edd)await t.query(`INSERT INTO lab_operational_registration(round_id,case_id,ga_weeks,ga_days,edd,pregnancy,paper_request,paper_consent,input_sha256,actor_id) VALUES($1,$2,0,0,$3,'Singleton',true,true,$4,$5)`,[c.roundId,c.caseId,edd,'a'.repeat(64),u.staff.id]);return c;});
 ids.late=await make('2026-10-01T03:00:00Z','2027-02-01');   // received Thu 1 Oct: long overdue; GA at 10 Oct = 23+5
 ids.soon=await make('2026-10-30T03:00:00Z');                // received Fri 30 Oct
 ids.fresh=await make('2026-11-09T03:00:00Z','2027-05-01');  // received Mon 9 Nov; GA 13+1, not over 18
 await db.query("INSERT INTO business_holiday(day,name) VALUES('2026-11-10','วันหยุดจำลอง')");
});
afterAll(async()=>{await db?.close();});

describe('Lab overview on the home page (Owner 2026-11-11)',()=>{
 it('counts open specimens against 8 working days, skipping weekends and synced holidays',async()=>{
  const o=await labOverview(q(),u.staff,NOW);
  expect(o.policy).toEqual({businessDays:8,warnDaysLeft:2});
  expect(o.tat.open).toBe(3);
  expect(o.tat.overdue).toBe(1);expect(o.tat.dueSoon).toBe(1);
  // Received Fri 30 Oct: Nov 2,3,4,5,6,9,11 = 7 working days (10 Nov is a holiday) -> 1 left.
  expect(o.tat.rows.map(r=>[r.caseId,r.state,r.left])).toEqual([[ids.late.caseId,'overdue',expect.any(Number)],[ids.soon.caseId,'due-soon',1]]);
  expect(o.tat.rows[0].left).toBeLessThan(0);
  expect(o.tat.rows[1]).toMatchObject({used:7,due:'2026-11-12',stage:'READY'});
 });
 it('lists specimens whose GA at collection is over 18+0 weeks',async()=>{
  const o=await labOverview(q(),u.staff,NOW);
  expect(o.gaOver18.count).toBe(1);
  expect(o.gaOver18.rows[0]).toMatchObject({caseId:ids.late.caseId,gaWeeks:23,gaDays:5});
 });
 it('six Bangkok months of receipts; nothing released yet',async()=>{
  const o=await labOverview(q(),u.staff,NOW);
  expect(o.quality.map(m=>m.month)).toEqual(lastMonths(NOW));
  expect(o.quality.at(-1)).toMatchObject({month:'2026-11',received:1,released:0,withinTat:0,medianDays:null});
  expect(o.quality.at(-2)).toMatchObject({month:'2026-10',received:2});
  expect(o.calendar.missingYears).toEqual([]);
 });
 it('Dashboard mode: aging by TAT state and 14 days of receipts, without rows or a PHI-access record (Owner 2026-11-14)',async()=>{
  const before=(await db.query<{n:number}>("SELECT count(*)::int n FROM phi_access_log WHERE actor_id=$1",[u.staff.id])).rows[0].n;
  const o=await labOverview(q(),u.staff,NOW,{rows:false});
  expect(o.tat.rows).toEqual([]);expect(o.gaOver18.rows).toEqual([]);expect(o.gaOver18.count).toBe(1);
  expect((await db.query<{n:number}>("SELECT count(*)::int n FROM phi_access_log WHERE actor_id=$1",[u.staff.id])).rows[0].n).toBe(before);
  const sum=(k:'ok'|'dueSoon'|'overdue')=>o.aging.reduce((n,b)=>n+b[k],0);
  expect([sum('ok'),sum('dueSoon'),sum('overdue')]).toEqual([1,1,1]);
  expect(o.aging).toHaveLength(o.policy.businessDays+5);
  expect(o.recent).toHaveLength(14);
  expect(o.recent.find(d=>d.day==='2026-10-30')).toMatchObject({received:1});
  expect(o.recent.find(d=>d.day==='2026-11-09')).toMatchObject({received:1});
 });
 it('records PHI access for the rows it shows, and a received specimen whose round is cancelled leaves the list',async()=>{
  const before=(await db.query<{n:number}>("SELECT count(*)::int n FROM phi_access_log WHERE actor_id=$1",[u.staff.id])).rows[0].n;
  await labOverview(q(),u.staff,NOW);
  expect((await db.query<{n:number}>("SELECT count(*)::int n FROM phi_access_log WHERE actor_id=$1",[u.staff.id])).rows[0].n).toBe(before+2);
  await db.query("UPDATE analytical_attempt SET state='Cancelled' WHERE round_id=$1",[ids.soon.roundId]);
  const o=await labOverview(q(),u.staff,NOW);
  expect(o.tat.open).toBe(2);expect(o.tat.dueSoon).toBe(0);
 });
 it('needs the worksheet permission',async()=>{
  await expect(labOverview(q(),u.anc as Principal,NOW)).rejects.toThrow();
 });
 it('counts High Risk results of the month by group, a result with both in each group (Owner 2026-11-14)',async()=>{
  await tx(q(),async t=>{
   // Fixture only (FKs off): a released SINGLETON result High Risk for T21 and with XXY detected.
   await t.query('SET LOCAL session_replication_role=replica');
   const id=randomUUID();
   await t.query(`INSERT INTO result_report_version(id,intake_file_id,sha256,kind,template_kind,template_version,parser_version,parsed,state,case_id,round_id,attempt_id,link_mode,imported_by) VALUES($1,$2,$3,'RESULT','SINGLETON','SYNTHETIC-v1','SYNTHETIC-v1',$4,'CertifiedReleased',$5,$6,$7,'MANUAL_REVIEWED',$8)`,
    [id,randomUUID(),id.replaceAll('-','').repeat(2),JSON.stringify({results:{t21:{value:'High Risk'},xxy:{value:'Detected'}}}),ids.fresh.caseId,ids.fresh.roundId,randomUUID(),u.staff.id]);
   await t.query(`INSERT INTO result_release(version_id,case_id,round_id,kind,channel,state,certified_by,certified_at) VALUES($1,$2,$3,'RESULT','NIPT_ANC_VIEW','Active',$4,$5)`,[id,ids.fresh.caseId,ids.fresh.roundId,u.staff.id,'2026-11-11T03:00:00Z']);
  });
  const o=await labOverview(q(),u.staff,NOW);
  expect(o.quality.at(-1)).toMatchObject({month:'2026-11',released:1,high:1,highTrisomy:1,highSca:1});
  // One result with two findings counts in each (Owner 2026-11-14).
  expect(o.quality.at(-1)!.positive).toEqual({t13:0,t18:0,t21:1,xo:0,xxx:0,xxy:1,xyy:0});
  expect(o.quality.at(-2)).toMatchObject({high:0,highTrisomy:0,highSca:0});
 });
 it('stage words come from the attempt state',()=>{
  expect(labStage({attempt_state:'Assigned',hold:false,run_label:'Run001/2026'} as never)).toBe('IN_RUN');
  expect(labStage({attempt_state:'QcFailed',hold:false,run_label:null} as never)).toBe('QC_FAILED');
  expect(labStage({attempt_state:'Ready',hold:true,run_label:null} as never)).toBe('HOLD');
 });
});
