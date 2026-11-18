import {it,expect,afterEach,beforeEach} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase} from '../helpers/database';
import {tx,labUsers} from '../helpers/lab';
import * as batch from '../../packages/lab/batch';
import {listUnifiedRunPage} from '../../packages/lab/historical-run';
import {MASTER_SHA256} from '../../packages/workbook/master';

// Run list "บันทึก QC แล้ว" (Owner 2026-11-18, Run009): saving a Task workbook draft (e.g. only locking Task List 1) is not QC.
// qc_saved needs all 3 Task Lists in the newest revision and a library concentration for every occupied slot.
let db:PGlite,u:Awaited<ReturnType<typeof labUsers>>;
beforeEach(async()=>{db=await testDatabase();u=await labUsers(db);});
afterEach(async()=>{await db.close();});

const placements=(slotsPerSheet:object[][])=>slotsPerSheet.map((slots,i)=>({id:`p${i}`,payload:{slots}}));
it('qc_saved is true only when every occupied slot of all three Task Lists has a library concentration in the newest revision',async()=>{
 const id=(await tx(db,t=>batch.createBatch(t,u.staff))).batchId;
 const save=async(revision:number,values:Record<string,unknown>,pl:object[])=>db.query("INSERT INTO task_workbook_revision(batch_id,revision,master_sha256,source_sha256,source_snapshot,values,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)",[id,revision,MASTER_SHA256,'b'.repeat(64),JSON.stringify({placements:pl}),JSON.stringify(values),u.staff.id]);
 const flag=async()=>(await tx(db,t=>listUnifiedRunPage(t,u.staff,{pageSize:10}))).rows.find(r=>r.id===id)!.qc_saved;
 const full=placements([[{slot:1,control:'positive'},{slot:2}],[{slot:17,attemptId:'a-17'}],[{slot:33,control:'negative'}]]);
 expect(await flag()).toBe(false);                                                                    // no revision
 await save(1,{'task.1.run':'Run009','slot.1.printedSampleId':'X'},placements([[{slot:1,control:'positive'}]]));
 expect(await flag()).toBe(false);                                                                    // Run009 case: only Task List 1 locked, draft saved
 await save(2,{'slot.1.libraryQc':5},full);expect(await flag()).toBe(false);                          // 3 lists but slots 17 and 33 have no value
 await save(3,{'slot.1.libraryQc':5,'slot.17.libraryQc':'4','slot.33.libraryQc':0.2},full);expect(await flag()).toBe(false);   // a text value is not a measurement
 await save(4,{'slot.1.libraryQc':5,'slot.17.libraryQc':4,'slot.33.libraryQc':0.2},full);expect(await flag()).toBe(true);     // all occupied slots measured; empty slot 2 needs none
 await save(5,{'slot.1.libraryQc':5,'slot.17.libraryQc':null,'slot.33.libraryQc':0.2},full);expect(await flag()).toBe(false);  // a later revision that clears one takes the status back
});
