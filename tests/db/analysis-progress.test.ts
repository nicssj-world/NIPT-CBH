import {it,expect,afterEach,beforeEach} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase} from '../helpers/database';
import {tx,labUsers,setPendingPolicy,syntheticCase,receiveS1,attemptOf,version} from '../helpers/lab';
import * as batch from '../../packages/lab/batch';
import {analysisSteps} from '../../packages/lab/analysis-progress';
import type {Queryable} from '../../packages/db/connection';
import {MASTER_SHA256} from '../../packages/workbook/master';

// ANC progress bar (Owner 2026-11-09): how many Lab Run steps the sample's Run has completed, from the same evidence as the Batch list.
let db:PGlite,u:Awaited<ReturnType<typeof labUsers>>;
beforeEach(async()=>{db=await testDatabase();u=await labUsers(db);});
afterEach(async()=>{await db.close();});
const q=()=>db as unknown as Queryable,run=<T>(fn:(t:Queryable)=>Promise<T>)=>tx(q(),fn),V=(id:string)=>version(q(),id);

it('counts Task Lists locked, QC saved, then stops at the first step that is not done; no Run means null',async()=>{
 await setPendingPolicy(q(),u,'PROCEED_SYNTHETIC_LABELLED');
 const cases=[];
 for(let n=0;n<3;n++){const c=await run(t=>syntheticCase(t,u));await run(t=>receiveS1(t,c,new Date(Date.now()-(300-n)*1000)));cases.push(c);}
 const rounds=cases.map(c=>c.roundId),steps=async()=>(await analysisSteps(q(),rounds));
 expect([...(await steps()).values()]).toEqual([null,null,null]);                               // received, not in any Run yet
 const id=(await run(t=>batch.createBatch(t,u.staff))).batchId;
 const slots=[2,18,34];                                                                         // one sample on each of the three Task Lists
 for(const [i,c] of cases.entries()){const a=await attemptOf(q(),c.roundId);await run(async t=>batch.assignExact(t,u.staff,{batchId:id,expectedVersion:await V(id),attemptId:a.id,slot:slots[i],mode:'MANUAL'}));}
 expect([...(await steps()).values()]).toEqual([0,0,0]);                                        // on a Task List
 const lock=async(sheetNumber:number)=>{
  await run(async t=>batch.updateSheetPlan(t,u.staff,{batchId:id,expectedVersion:await V(id),sheetNumber,plannedWorkDate:'2026-11-09',plannedOperator:'SYNTHETIC LAB',plannedExtractionLot:null,plannedExtractionExpiry:null,plannedLibraryLot:null,plannedLibraryExpiry:null}));
  await run(async t=>batch.planCheck(t,u.staff,{batchId:id,expectedVersion:await V(id),sheetNumber,confirm:{controlsAtTemplate:true,identifiersMatch:true,noDuplicates:true}}));
  await run(async t=>batch.finalizeSheet(t,u.staff,{batchId:id,expectedVersion:await V(id),sheetNumber}));
 };
 await lock(1);await lock(2);
 expect((await steps()).get(rounds[0])).toBe(0);                                                // two of three locked: not yet
 await lock(3);
 expect([...(await steps()).values()]).toEqual([1,1,1]);                                        // all three locked -> QC next
 const save=(rev:number,values:object)=>db.query("INSERT INTO task_workbook_revision(batch_id,revision,master_sha256,source_sha256,source_snapshot,values,created_by) VALUES($1,$2,$3,$4,'{}',$5,$6)",[id,rev,MASTER_SHA256,String(rev).repeat(64).slice(0,64).replace(/[^a-f0-9]/g,'a'),JSON.stringify(values),u.staff.id]);
 await save(1,{});
 expect((await steps()).get(rounds[0])).toBe(2);                                                // QC saved -> Pooling next
 await save(2,{'seq.loadedDnb':1,'seq.q30':2,'seq.bic':3,'seq.fit':4});
 expect((await steps()).get(rounds[0])).toBe(2);                                                // a sequencing result without a recorded Pooling does not skip ahead
});
