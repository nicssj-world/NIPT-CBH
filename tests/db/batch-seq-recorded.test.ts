import {it,expect,afterEach,beforeEach} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase} from '../helpers/database';
import {tx,labUsers} from '../helpers/lab';
import * as batch from '../../packages/lab/batch';
import {listUnifiedRunPage} from '../../packages/lab/historical-run';
import {MASTER_SHA256} from '../../packages/workbook/master';

// Batch list last step (Owner 2026-11-09): "บันทึกผล Sequencing แล้ว" only when the newest saved workbook holds all four first-cycle values as numbers.
let db:PGlite,u:Awaited<ReturnType<typeof labUsers>>;
beforeEach(async()=>{db=await testDatabase();u=await labUsers(db);});
afterEach(async()=>{await db.close();});

const FIRST_CYCLE={'seq.loadedDnb':71.2,'seq.q30':92.5,'seq.bic':98,'seq.fit':0.98};
it('seq_recorded is true only for a complete, numeric first-cycle result in the newest revision',async()=>{
 const id=(await tx(db,t=>batch.createBatch(t,u.staff))).batchId;
 const save=async(revision:number,values:Record<string,unknown>)=>db.query("INSERT INTO task_workbook_revision(batch_id,revision,master_sha256,source_sha256,source_snapshot,values,created_by) VALUES($1,$2,$3,$4,'{}',$5,$6)",[id,revision,MASTER_SHA256,'b'.repeat(64),JSON.stringify(values),u.staff.id]);
 const flag=async()=>(await tx(db,t=>listUnifiedRunPage(t,u.staff,{pageSize:10}))).rows.find(r=>r.id===id)!.seq_recorded;
 expect(await flag()).toBe(false);                                                   // no revision at all
 await save(1,{});expect(await flag()).toBe(false);                                  // QC saved, no sequencing values
 await save(2,{'seq.loadedDnb':71.2,'seq.q30':92.5,'seq.bic':98});expect(await flag()).toBe(false);   // one value missing (NULL must not count as ok)
 await save(3,{...FIRST_CYCLE,'seq.fit':'0.98'});expect(await flag()).toBe(false);   // a text value is not a measurement
 await save(4,FIRST_CYCLE);expect(await flag()).toBe(true);                          // all four numbers
 await save(5,{...FIRST_CYCLE,'seq.q30':null});expect(await flag()).toBe(false);     // a later revision that clears one value takes the status back
});
