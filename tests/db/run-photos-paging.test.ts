import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase} from '../helpers/database';
import {tx,labUsers} from '../helpers/lab';
import {photoRoots,uploadPhoto} from '../helpers/photos';
import * as batch from '../../packages/lab/batch';
import {searchRunPhotos,SEARCH_PHOTO_CAP} from '../../packages/run-photos/service';
import type {Queryable} from '../../packages/db/connection';

// Photo search used to show the newest 60/200 Runs and 300 photos with a heading that read like the real totals, and a Run whose only matching
// photo fell past the 300 cap disappeared from the results. Totals are now exact, older Runs load in blocks and the cap is reported.
let db:PGlite,u:Awaited<ReturnType<typeof labUsers>>,roots:Awaited<ReturnType<typeof photoRoots>>;
const q=()=>db as unknown as Queryable;
const RUNS=70,PHOTOS=SEARCH_PHOTO_CAP+5;
let oldest:string,newest:string;
const search=(raw:Record<string,unknown>={})=>searchRunPhotos(q(),u.staff,raw);
const version=async(id:string)=>(await db.query<{version:number}>('SELECT version FROM lab_batch WHERE id=$1',[id])).rows[0].version;
beforeAll(async()=>{
 db=await testDatabase();u=await labUsers(q());roots=await photoRoots();
 for(let i=0;i<RUNS;i++){
  const b=await tx(q(),t=>batch.createBatch(t,u.staff));
  if(i===0){oldest=b.batchId;await uploadPhoto(q(),u.staff,b.batchId,{caption:'cap-needle (older Run)',takenOn:'2026-01-05'});await uploadPhoto(q(),u.staff,b.batchId,{caption:'50% rack',takenOn:'2026-01-06'});}
  if(i===RUNS-1){newest=b.batchId;break;}
  await tx(q(),async t=>batch.cancelBatch(t,u.staff,{batchId:b.batchId,expectedVersion:await version(b.batchId),reason:'SYNTHETIC cancel for photo paging'}));
 }
 for(let i=0;i<PHOTOS;i++)await uploadPhoto(q(),u.staff,newest,{caption:`cap-needle ${i}`,sampleFrom:1,sampleTo:2});
},900000);
afterAll(async()=>{await db?.close();await roots?.close();});

describe('Run list in photo search',()=>{
 it('shows the newest 60 with an exact total, and "load more" reaches every older Run once',async()=>{
  const first=await search();expect(first.criteria).toBe(false);expect(first.runs).toHaveLength(60);expect(first.runTotal).toBe(RUNS);expect(first.hasMoreRuns).toBe(true);expect(first.nextRunsOffset).toBe(60);
  const more=await search({runsOffset:first.nextRunsOffset});expect(more.runs).toHaveLength(RUNS-60);expect(more.hasMoreRuns).toBe(false);
  const ids=[...first.runs,...more.runs].map(r=>r.id);expect(new Set(ids).size).toBe(RUNS);expect(ids).toContain(oldest);expect(ids[0]).toBe(newest);
 });
});
describe('photo results',()=>{
 it('reports the true photo total and that the 300-photo cap was reached',async()=>{
  const r=await search({text:'cap-needle'});
  expect(r.photos).toHaveLength(SEARCH_PHOTO_CAP);expect(r.photoTotal).toBe(PHOTOS+1);expect(r.photosTruncated).toBe(true);expect(r.photoCap).toBe(SEARCH_PHOTO_CAP);
  const small=await search({text:'older Run'});expect(small.photosTruncated).toBe(false);expect(small.photoTotal).toBe(small.photos.length);expect(small.photos).toHaveLength(1);
 });
 it('a Run whose only matching photo is past the cap is still listed',async()=>{
  const r=await search({text:'cap-needle'});
  expect(r.photos.every(p=>p.batchId===newest)).toBe(true);        // the cap list holds only the newest Run's photos
  expect(r.runs.map(x=>x.id).sort()).toEqual([newest,oldest].sort());expect(r.runTotal).toBe(2); // …yet both Runs are found
  expect((await search({sample:1})).runTotal).toBe(1);
 });
 it('searches captions containing % or _ literally (the previous empty ESCAPE made them unmatchable)',async()=>{
  const r=await search({text:'50%'});expect(r.photos.map(p=>p.caption)).toEqual(['50% rack']);expect(r.runs.map(x=>x.id)).toEqual([oldest]);
  expect((await search({text:'%'})).photoTotal).toBe(1); // only the caption that really contains "%"
 });
 it('rejects a negative offset or unknown field',async()=>{
  await expect(search({runsOffset:-1})).rejects.toThrow();await expect(search({bogus:1})).rejects.toThrow();
 });
});
