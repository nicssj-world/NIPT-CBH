import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {PDFDocument} from 'pdf-lib';
import {task3Fixture} from '../helpers/task3';
import {benchWorkspace} from '../../packages/lab/bench';
import {saveWorkbookDraft,exportWorkbook} from '../../packages/workbook/service';
import {SHEETS} from '../../packages/workbook/master';
import {sha256} from '../../packages/workbook/archive';

// The native render takes about 30 s; a retry or a second look at the same saved revision must not start Excel again.
it('a second PDF request for the same revision and sheet reuses the first (no new render); a new revision renders again',async()=>{
 const f=await task3Fixture();
 try{
  let renders=0;
  const render=async()=>{renders++;const d=await PDFDocument.create();d.addPage([595.28,841.89]);const bytes=Buffer.from(await d.save());
   return SHEETS.map(sheet=>({sheet,bytes,sha256:sha256(bytes),pageCount:1,pages:[],formulaCount:0,formulaErrors:[],poolingCalculation:null,renderer:'Microsoft Excel' as const}));};
  const deps={master:readFileSync(process.env.NIPT_TASK_MASTER_PATH!),store:f.store,render} as unknown as Parameters<typeof benchWorkspace>[3];
  const ws=await f.run(t=>benchWorkspace(t,f.u.staff,f.batchId,deps));
  const sheet=SHEETS[0],ask=(revision:number)=>f.run(t=>exportWorkbook(t,f.u.staff,{batchId:f.batchId,revision,format:'PDF',sheet},deps));
  const first=await ask(ws.revision),second=await ask(ws.revision);
  expect(renders).toBe(1);expect(second.id).toBe(first.id);expect(second.sha256).toBe(first.sha256);expect(second.bytes.equals(first.bytes)).toBe(true);
  const version=async()=>(await f.db.query<{version:number}>('SELECT version FROM lab_batch WHERE id=$1',[f.batchId])).rows[0].version;
  await f.run(async t=>saveWorkbookDraft(t,f.u.staff,{batchId:f.batchId,expectedVersion:await version(),expectedRevision:ws.revision,values:{...ws.values,'qc.1.standard1':12}},deps));
  const next=(await f.run(t=>benchWorkspace(t,f.u.staff,f.batchId,deps))).revision;
  const third=await ask(next);
  expect(next).toBe(ws.revision+1);expect(renders).toBe(2);expect(third.id).not.toBe(first.id);
  const audits=(await f.db.query<{outcome:string}>("SELECT details->>'outcome' outcome FROM audit_chain WHERE action='TASK_WORKBOOK_EXPORTED' AND resource_id=$1",[first.id])).rows.map(r=>r.outcome);
  expect(audits).toEqual(expect.arrayContaining(['PDF','PDF_REUSED']));
 }finally{await f.close();}
},300000);
