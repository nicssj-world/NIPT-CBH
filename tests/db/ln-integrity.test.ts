import {describe,it,expect,beforeEach,afterEach,vi} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase} from '../helpers/database';
import {tx,labUsers,setPendingPolicy,syntheticCase,receiveS1,attemptOf,version} from '../helpers/lab';
import * as intake from '../../packages/lab/intake';
import * as batch from '../../packages/lab/batch';
import type {Queryable} from '../../packages/db/connection';

// Plan Rev 3.4 §11A missing regressions 3–4 (existing protection, now pinned by tests). Synthetic PGlite only.
let db:PGlite,u:Awaited<ReturnType<typeof labUsers>>;
beforeEach(async()=>{db=await testDatabase();u=await labUsers(db);});
afterEach(async()=>{vi.unstubAllEnvs();await db.close();});
const q=()=>db as unknown as Queryable;
const run=<T>(fn:(t:Queryable)=>Promise<T>)=>tx(q(),fn);
async function received(){const c=await run(t=>syntheticCase(t,u));await run(t=>receiveS1(t,c));return c;}
const rounds=async(caseId:string)=>(await db.query<{n:number}>('SELECT count(*)::int n FROM specimen_round WHERE case_id=$1',[caseId])).rows[0].n;

describe('Redraw and repeat cannot be duplicated',()=>{
 it('a second redraw order while S2 is Expected is refused; rounds unchanged',async()=>{
  const c=await received();
  await run(t=>intake.orderRedraw(t,u.certifier,{caseId:c.caseId,reasonCode:'SPECIMEN_PROBLEM',note:'จำลอง หลอดมีปัญหา'}));
  expect(await rounds(c.caseId)).toBe(2);
  await expect(run(t=>intake.orderRedraw(t,u.certifier,{caseId:c.caseId,reasonCode:'SPECIMEN_PROBLEM',note:'จำลอง สั่งซ้ำ'}))).rejects.toMatchObject({code:'REDRAW_REQUIRES_RECEIVED_CURRENT_ROUND'});
  expect(await rounds(c.caseId)).toBe(2);
 });
 it('operational mode refuses a local S2 receipt (new HIS PET required) and issues no LN Halos',async()=>{
  const c=await received();
  const r=await run(t=>intake.orderRedraw(t,u.certifier,{caseId:c.caseId,reasonCode:'SPECIMEN_PROBLEM',note:'จำลอง หลอดมีปัญหา'}));
  vi.stubEnv('NIPT_MODE','operational');
  await expect(run(t=>intake.receiveRedraw(t,u.staff,{roundId:r.newRoundId,identityChecked:true,labelChecked:true,condition:'ACCEPTABLE',collectionDate:'2026-10-11'}))).rejects.toMatchObject({code:'REDRAW_REQUIRES_NEW_HIS_PET'});
  expect((await db.query('SELECT 1 FROM specimen_lab_number WHERE round_id=$1',[r.newRoundId])).rows).toHaveLength(0);
 });
 it('a second repeat on the superseded parent is refused; one active repeat order',async()=>{
  await setPendingPolicy(q(),u,'PROCEED_SYNTHETIC_LABELLED');
  const c=await received(),a=await attemptOf(q(),c.roundId);
  const b=await run(t=>batch.createBatch(t,u.staff));
  await run(t=>batch.assignToBatch(t,u.staff,{batchId:b.batchId,expectedVersion:0,attemptIds:[a.id]}));
  await run(async t=>batch.updateSheetPlan(t,u.staff,{batchId:b.batchId,expectedVersion:await version(t,b.batchId),sheetNumber:1,plannedWorkDate:'2026-10-12',plannedOperator:null,plannedExtractionLot:null,plannedExtractionExpiry:null,plannedLibraryLot:null,plannedLibraryExpiry:null}));
  await run(async t=>batch.planCheck(t,u.staff,{batchId:b.batchId,expectedVersion:await version(t,b.batchId),sheetNumber:1,confirm:{controlsAtTemplate:true,identifiersMatch:true,noDuplicates:true}}));
  await run(async t=>batch.finalizeSheet(t,u.staff,{batchId:b.batchId,expectedVersion:await version(t,b.batchId),sheetNumber:1}));
  await run(async t=>batch.cancelBatch(t,u.certifier,{batchId:b.batchId,expectedVersion:await version(t,b.batchId),reason:'จำลอง ยกเลิกหลังล็อก'}));
  expect(await attemptOf(q(),c.roundId)).toMatchObject({state:'BatchCancelled'});
  await run(t=>intake.orderRepeat(t,u.staff,{attemptId:a.id,level:'RE_LIBRARY',reasonCode:'QC1_LOW',note:'จำลอง ทำซ้ำ'}));
  await expect(run(t=>intake.orderRepeat(t,u.staff,{attemptId:a.id,level:'RE_LIBRARY',reasonCode:'QC1_LOW',note:'จำลอง ทำซ้ำอีก'}))).rejects.toMatchObject({code:'REPEAT_REQUIRES_FAILED_OR_STOPPED_ATTEMPT'});
  expect((await db.query<{n:number}>("SELECT count(*)::int n FROM repeat_work_order WHERE round_id=$1",[c.roundId])).rows[0].n).toBe(1);
  expect(await rounds(c.caseId)).toBe(1); // repeat never creates a specimen round or LN Halos
  expect((await db.query<{n:number}>('SELECT count(*)::int n FROM specimen_lab_number WHERE case_id=$1',[c.caseId])).rows[0].n).toBe(1);
 });
});
describe('LN Halos monthly counter is keyed by Bangkok month and year',()=>{
 it('previous month and the same month of the previous year never continue into the current month',async()=>{
  const month=(await db.query<{m:string}>("SELECT to_char(date_trunc('month',now() AT TIME ZONE 'Asia/Bangkok'),'YYYY-MM-DD') m")).rows[0].m; // first day of the current Bangkok month
  const [y,m]=month.split('-').map(Number),prev=new Date(Date.UTC(y,m-2,1)).toISOString().slice(0,10),lastYear=`${y-1}-${String(m).padStart(2,'0')}-01`;
  await db.query('INSERT INTO ln_halos_monthly_sequence(sequence_month,last_value) VALUES($1,500),($2,700)',[prev,lastYear]);
  const c=await received();
  const issued=(await db.query<{ln_halos:string;sequence_value:number}>('SELECT ln_halos,sequence_value FROM specimen_lab_number WHERE round_id=$1',[c.roundId])).rows[0];
  expect(issued.sequence_value).toBe(1);expect(issued.ln_halos.endsWith('001')).toBe(true);
  expect((await db.query('SELECT sequence_month::text m,last_value v FROM ln_halos_monthly_sequence ORDER BY sequence_month')).rows).toEqual([{m:lastYear,v:700},{m:prev,v:500},{m:month,v:1}]);
 });
});
