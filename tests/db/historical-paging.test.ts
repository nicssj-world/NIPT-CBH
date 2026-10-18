import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import {histFixture,importBatch,attest,goodRow,pdfFor,LOOKUP_KEY,type HistFixture} from '../helpers/historical';
import {getBatch,listBatches,confirmBatch} from '../../packages/historical/service';
import {randomUUID} from 'node:crypto';

// /historical/:id used to return every row of the batch and filter in the browser. It now returns one page, a summary counted over the whole
// batch, and searches by LN on the server; confirmation still works on every row the reviewer ticked, wherever it was shown.
const GOOD=62,BAD=6;
let f:HistFixture,batch:string;
const get=(raw:Record<string,unknown>)=>f.run(t=>getBatch(t,f.verifier,batch,raw));
const everyPage=async(raw:Record<string,unknown>)=>{const rows=[];for(let page=1;;page++){const d=await get({...raw,page});rows.push(...d.rows);if(page>=d.page.totalPages)return {rows,first:d};}};
beforeAll(async()=>{
 f=await histFixture();await f.configure();
 const rows=[...Array.from({length:GOOD},(_,i)=>goodRow(i+1)),...Array.from({length:BAD},(_,i)=>goodRow(GOOD+i+1,{dob:'not-a-date'}))];
 batch=await importBatch(f,rows,rows.map(r=>({name:r.pdf_file!,bytes:pdfFor(r)})));
},300000);
afterAll(async()=>{await f?.close();});

describe('one batch, paged',()=>{
 it('every row is reachable once in row order; the summary and totals are counted over the whole batch',async()=>{
  const first=await get({pageSize:50});
  expect(first.summary).toMatchObject({total:GOOD+BAD});expect(first.page).toMatchObject({number:1,size:50,total:GOOD+BAD,totalPages:2});expect(first.rows).toHaveLength(50);
  const {rows}=await everyPage({pageSize:50});
  expect(rows.map(r=>r.rowNo)).toEqual(Array.from({length:GOOD+BAD},(_,i)=>i+2)) // row 1 of the file is the header;
  expect(first.summary.ready+first.summary.problem+first.summary.done).toBe(GOOD+BAD);
  const all100=await get({pageSize:100});expect(all100.rows).toHaveLength(GOOD+BAD);expect(all100.page.totalPages).toBe(1);
 });
 it('views filter on the server: problems / ready / done / auto, each with an exact total and no row lost',async()=>{
  const sum=(await get({})).summary;
  const problems=await everyPage({view:'problems',pageSize:50}),ready=await everyPage({view:'ready',pageSize:50});
  expect(problems.first.page.total).toBe(sum.problem);expect(problems.rows).toHaveLength(sum.problem);for(const r of problems.rows)expect(['Draft','NotEligible','Discrepancy','Conflict']).toContain(r.state);
  expect(ready.first.page.total).toBe(sum.ready);expect(ready.rows).toHaveLength(sum.ready);for(const r of ready.rows)expect(r.state).toBe('Submitted');
  expect(new Set([...problems.rows,...ready.rows].map(r=>r.id)).size).toBe(sum.problem+sum.ready);
  expect((await get({view:'auto'})).view).toBe(sum.problem>0?'problems':'all');
  expect((await get({view:'done'})).page.total).toBe(sum.done);
 });
 it('LN search covers the whole batch, not the page on screen',async()=>{
  const target=goodRow(GOOD+3);                         // far down: page 2
  expect((await get({pageSize:50})).rows.some(r=>r.ln===target.ln)).toBe(false);
  const hit=await get({q:target.ln!,pageSize:50});expect(hit.rows.map(r=>r.ln)).toEqual([target.ln]);expect(hit.page.total).toBe(1);
  expect((await get({q:String(target.ln).slice(-3),pageSize:50,view:'all'})).page.total).toBeGreaterThan(0);
  expect((await get({q:'no-such-ln'})).page).toMatchObject({total:0,number:1,totalPages:1});
 });
 it('only 50 or 100 per page; a page past the end gives the last page; unknown fields refused',async()=>{
  await expect(get({pageSize:25})).rejects.toThrow();await expect(get({view:'x'})).rejects.toThrow();await expect(get({bogus:1})).rejects.toThrow();
  const past=await get({page:999,pageSize:50});expect(past.page.number).toBe(2);expect(past.rows).toHaveLength(GOOD+BAD-50);
 });
 it('confirmation is not limited to the rows shown: rows picked from page 1 and page 2 are promoted in one request',async()=>{
  const p1=(await get({view:'ready',pageSize:50,page:1})).rows,p2=(await get({view:'ready',pageSize:50,page:2})).rows;
  expect(p2.length).toBeGreaterThan(0);
  const picked=[p1[0],p1[1],p2[0]];
  const out=await f.run(t=>confirmBatch(t,f.verifier,batch,LOOKUP_KEY,{idempotencyKey:randomUUID(),rows:picked.map(r=>({draftId:r.id,version:r.version,attestation:attest()}))}));
  expect(out.outcomes).toHaveLength(3);expect(out.outcomes.every(o=>o.outcome==='PROMOTED')).toBe(true);
  expect((await get({view:'done'})).page.total).toBe(3);
 });
});

describe('batch list',()=>{
 it('pages through every batch, newest first, with the counts of only the batches on the page',async()=>{
  for(let i=0;i<30;i++)await f.db.query("INSERT INTO historical_batch(state,created_by,idempotency_key,table_name,table_sha256,issues,created_at) VALUES('Staged',$1,$2,$3,$4,'[]',now()-($5||' hours')::interval)",[f.maker.id,'key-'+randomUUID(),`older-${i}.csv`,'a'.repeat(64),String(i+1)]);
  const total=Number((await f.db.query<{n:string}>('SELECT count(*) n FROM historical_batch')).rows[0].n);expect(total).toBe(31);
  const p1=await f.run(t=>listBatches(t,f.maker,{page:1,pageSize:25})),p2=await f.run(t=>listBatches(t,f.maker,{page:2,pageSize:25}));
  expect(p1.page).toMatchObject({total:31,totalPages:2});expect(p1.batches).toHaveLength(25);expect(p2.batches).toHaveLength(6);
  expect(new Set([...p1.batches,...p2.batches].map(b=>b.id)).size).toBe(31);
  expect(p1.batches[0].table_name).toBe('historical.csv');expect(p2.batches.at(-1)!.table_name).toBe('older-29.csv'); // the oldest, beyond the 25 newest
  expect(p1.batches[0]).toMatchObject({submitted:expect.any(Number),promoted:3,needs_attention:expect.any(Number)});
  await expect(f.run(t=>listBatches(t,f.maker,{pageSize:10}))).rejects.toThrow();
 });
});
