import {describe,it,expect,beforeEach,afterEach} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase} from '../helpers/database';
import {tx,labUsers,version} from '../helpers/lab';
import * as batch from '../../packages/lab/batch';
import {requestSchema,emptyRequest} from '../../packages/p2/schema';
import type {Queryable} from '../../packages/db/connection';

// Plan Rev 3.4 §7.2 (OD-L revised): hard-block only non-existent dates and BE years sent as CE; real but unusual dates stay valid.
let db:PGlite,u:Awaited<ReturnType<typeof labUsers>>;
beforeEach(async()=>{db=await testDatabase();u=await labUsers(db);});
afterEach(async()=>{await db.close();});
const run=<T>(fn:(t:Queryable)=>Promise<T>)=>tx(db as unknown as Queryable,fn);
const plan=(batchId:string,v:number,date:string,expiry:string|null=null)=>({batchId,expectedVersion:v,sheetNumber:1,plannedWorkDate:date,plannedOperator:null,plannedExtractionLot:expiry?'SYN-LOT':null,plannedExtractionExpiry:expiry,plannedLibraryLot:null,plannedLibraryExpiry:null});

describe('Server date guard on Task metadata',()=>{
 it('rejects a BE year sent as CE and a non-existent date, and stores nothing',async()=>{
  const b=await run(t=>batch.createBatch(t,u.staff));
  await expect(run(async t=>batch.updateSheetPlan(t,u.staff,plan(b.batchId,await version(t,b.batchId),'2569-10-17')))).rejects.toThrow(/DATE_LIKELY_BUDDHIST_ERA/);
  await expect(run(async t=>batch.updateSheetPlan(t,u.staff,plan(b.batchId,await version(t,b.batchId),'2026-02-31')))).rejects.toThrow(/INVALID_DATE/);
  await expect(run(async t=>batch.updateSheetPlan(t,u.staff,plan(b.batchId,await version(t,b.batchId),'2026-10-17','2570-01-31')))).rejects.toThrow(/DATE_LIKELY_BUDDHIST_ERA/);
  expect((await db.query<{d:string|null}>('SELECT planned_work_date::text d FROM lab_task_sheet WHERE batch_id=$1 AND sheet_number=1',[b.batchId])).rows[0].d).toBeNull();
 });
 it('accepts real dates including backdated and far-future ones (warnings are not hard errors)',async()=>{
  const b=await run(t=>batch.createBatch(t,u.staff));
  for(const d of ['2026-10-17','2020-01-02','2031-12-31']){
   await run(async t=>batch.updateSheetPlan(t,u.staff,plan(b.batchId,await version(t,b.batchId),d,'2027-01-31')));
   expect((await db.query<{d:string}>('SELECT planned_work_date::text d FROM lab_task_sheet WHERE batch_id=$1 AND sheet_number=1',[b.batchId])).rows[0].d).toBe(d);
  }
 });
});
describe('Server date guard on clinical request dates (EDD / DOB / collection)',()=>{
 const draft=(p:Partial<typeof emptyRequest.pregnancy>,dob:string|null=null)=>({...emptyRequest,patient:{...emptyRequest.patient,dob},pregnancy:{...emptyRequest.pregnancy,...p}});
 it('rejects BE-as-CE years even when EDD and collection are shifted together (GA alone would not catch it)',()=>{
  const r=requestSchema.safeParse(draft({edd:'2570-04-29',collectionDate:'2569-10-17'}));
  expect(r.success).toBe(false);expect(r.error?.issues.map(i=>i.message)).toContain('DATE_LIKELY_BUDDHIST_ERA');
  expect(requestSchema.safeParse(draft({},'2533-05-01')).success).toBe(false);
 });
 it('keeps real dates valid',()=>{
  expect(requestSchema.safeParse(draft({edd:'2027-04-29',collectionDate:'2026-10-17'},'1990-05-01')).success).toBe(true);
 });
});
