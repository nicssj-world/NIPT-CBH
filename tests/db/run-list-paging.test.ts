import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase} from '../helpers/database';
import {tx,labUsers} from '../helpers/lab';
import * as batch from '../../packages/lab/batch';
import type {Queryable} from '../../packages/db/connection';

// The Run list used to stop at the newest 100 Runs. It now pages through every Run with an exact total, a secondary sort and a Run search.
let db:PGlite,u:Awaited<ReturnType<typeof labUsers>>;
const q=()=>db as unknown as Queryable;
const RUNS=130;
const list=(raw:Record<string,unknown>)=>batch.listBatchPage(q(),u.staff,raw);
beforeAll(async()=>{
 db=await testDatabase();u=await labUsers(q());
 for(let i=0;i<RUNS-1;i++){
  const b=await tx(q(),t=>batch.createBatch(t,u.staff));
  await tx(q(),async t=>batch.cancelBatch(t,u.staff,{batchId:b.batchId,expectedVersion:(await t.query<{version:number}>('SELECT version FROM lab_batch WHERE id=$1',[b.batchId])).rows[0].version,reason:'SYNTHETIC cancel for Run list paging'}));
 }
 await tx(q(),t=>batch.createBatch(t,u.staff)); // the newest Run stays an open Draft
},300000);
afterAll(async()=>{await db?.close();});

describe('Run list paging',()=>{
 it('every Run is reachable once, newest first with a stable secondary sort, and the total is exact',async()=>{
  const expected=(await db.query<{id:string}>('SELECT id FROM lab_batch ORDER BY created_at DESC,id DESC')).rows.map(r=>r.id);
  expect(expected).toHaveLength(RUNS);
  for(const size of [25,50,100]){
   const got:string[]=[];let p=1,total=0,pages=0;
   do{const r=await list({page:p,pageSize:size});total=r.page.total;pages=r.page.totalPages;expect(r.page.number).toBe(p);expect(r.rows.length).toBe(Math.min(size,RUNS-(p-1)*size));got.push(...r.rows.map(x=>x.id));p++;}while(p<=pages);
   expect(total,`size ${size}`).toBe(RUNS);expect(pages).toBe(Math.ceil(RUNS/size));expect(got,`size ${size}`).toEqual(expected);
  }
  // the first-ever Run (older than the 100 newest the old list stopped at) is on the last page
  const last=await list({page:6,pageSize:25});expect(last.rows.at(-1)!.run_label).toMatch(/^Run001\//);
 });
 it('search finds an old Run by any part of its identifier; page and size survive; an empty result is page 1 of 1',async()=>{
  expect((await list({q:'Run001'})).rows.map(r=>r.run_label)).toEqual([expect.stringMatching(/^Run001\//)]);
  const byNumber=await list({q:'16'});expect(byNumber.page.total).toBeGreaterThan(0);for(const r of byNumber.rows)expect(r.run_label.toLowerCase()).toContain('16');
  const year=String(new Date().getFullYear());expect((await list({q:year,pageSize:100})).page.total).toBe(RUNS);
  expect((await list({q:'Run999'})).page).toMatchObject({total:0,number:1,totalPages:1});
  expect((await list({q:'RUN130'})).rows).toHaveLength(1); // case-insensitive
 });
 it('open mode returns only Runs whose Task Lists can still be edited, however many finished Runs are newer or older',async()=>{
  const open=await list({open:'1',pageSize:100});expect(open.page.total).toBe(1);expect(open.rows[0]).toMatchObject({state:'Draft',run_label:expect.stringMatching(/^Run130\//)});
  expect(open.rows.every(r=>r.sheet_states.some(s=>['Draft','PlanChecked','Amended'].includes(s)))).toBe(true);
 });
 it('rejects sizes outside 25/50/100, unknown fields and roles without worksheet access; clamps a page past the end',async()=>{
  await expect(list({pageSize:30})).rejects.toThrow();await expect(list({page:0})).rejects.toThrow();await expect(list({nope:1})).rejects.toThrow();
  await expect(batch.listBatchPage(q(),u.anc,{})).rejects.toMatchObject({code:'FORBIDDEN'});
  const past=await list({page:999,pageSize:50});expect(past.page.number).toBe(3);expect(past.rows).toHaveLength(RUNS-100);
 });
});
