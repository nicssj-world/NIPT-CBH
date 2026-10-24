import {it,expect,vi,afterEach} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import {testDatabase} from '../helpers/database';
import {tx,labUsers,setPendingPolicy,syntheticCase,receiveS1,docDeps,attemptOf,version} from '../helpers/lab';
import * as batch from '../../packages/lab/batch';
import * as records from '../../packages/lab/records';
import {issueNativeWorkbook} from '../../packages/workbook/controlled';
import {SHEETS,MASTER_SHA256} from '../../packages/workbook/master';
import {sha256} from '../../packages/workbook/archive';
import {PDFDocument} from 'pdf-lib';
const masterPath=process.env.NIPT_TASK_MASTER_PATH??'.local/lab-owner-evidence/lab-combined-master.xlsx';
afterEach(()=>vi.unstubAllEnvs());
it.skipIf(!existsSync(masterPath))('native artifacts preserve issued bytes and placement during Task1 metadata edits and enforce DB integrity',async()=>{
 const db=await testDatabase(),u=await labUsers(db),docs=await docDeps();
 try{
  await setPendingPolicy(db,u,'PROCEED_SYNTHETIC_LABELLED');
  const c=await tx(db,t=>syntheticCase(t,u));await tx(db,t=>receiveS1(t,c));const a=await attemptOf(db,c.roundId);
  const b=await tx(db,t=>batch.createBatch(t,u.staff)),id=b.batchId,V=()=>version(db,id);
  await tx(db,t=>batch.assignToBatch(t,u.staff,{batchId:id,expectedVersion:0,attemptIds:[a.id]}));
  const finalize=async()=>{
   await tx(db,async t=>batch.updateSheetPlan(t,u.staff,{batchId:id,expectedVersion:await V(),sheetNumber:1,plannedWorkDate:'2026-10-15',plannedOperator:'LOCAL TEST OPERATOR',plannedExtractionLot:null,plannedExtractionExpiry:null,plannedLibraryLot:null,plannedLibraryExpiry:null}));
   await tx(db,async t=>batch.planCheck(t,u.staff,{batchId:id,expectedVersion:await V(),sheetNumber:1,confirm:{controlsAtTemplate:true,identifiersMatch:true,noDuplicates:true}}));
   await tx(db,async t=>batch.finalizeSheet(t,u.staff,{batchId:id,expectedVersion:await V(),sheetNumber:1}));
  };await finalize();
  vi.stubEnv('NIPT_MODE','operational');vi.stubEnv('APP_ORIGIN','https://nipt.test');await db.query("UPDATE nipt_runtime_config SET mode='operational'");
  // Ledger test only: real Microsoft Excel rendering is exercised by the positive native browser journey.
  const render=async()=>{const document=await PDFDocument.create();document.addPage([595.28,841.89]);document.addPage([595.28,841.89]);const bytes=Buffer.from(await document.save());return SHEETS.map(sheet=>({sheet,bytes,sha256:sha256(bytes),pageCount:2,pages:[],formulaCount:0,formulaErrors:[],poolingCalculation:null,renderer:'Microsoft Excel' as const,goldenFidelityVerified:false as const,nativeCoordinateScale:1}));};
  const deps={...docs.deps,native:(t:Parameters<typeof issueNativeWorkbook>[0],user:Parameters<typeof issueNativeWorkbook>[1],input:Parameters<typeof issueNativeWorkbook>[2])=>issueNativeWorkbook(t,user,input,{master:readFileSync(masterPath),store:docs.deps.store,render})};
  const pre=await tx(db,async t=>records.issuePreWork(t,u.staff,{batchId:id,expectedVersion:await V(),sheetNumber:1},deps));
  const row=(await db.query<{snapshot:Record<string,unknown>;file_sha256:string}>('SELECT snapshot,file_sha256 FROM lab_document WHERE id=$1',[pre.id])).rows[0];
  expect(row.snapshot).toMatchObject({nativeMaster:true,synthetic:false,masterSha256:MASTER_SHA256,form:'F2',sheet:SHEETS[0]});
  expect((await db.query('SELECT format FROM task_workbook_export ORDER BY format')).rows).toEqual([{format:'PDF'},{format:'XLSX'}]);
  const original=await tx(db,t=>records.readOriginal(t,u.staff,pre.id,deps));
  const copy=await tx(db,t=>records.printDocument(t,u.staff,{documentId:pre.id,kind:'WORKING_COPY'},deps));expect(copy.bytes).not.toEqual(original.bytes);expect(copy.copyNumber).toBe(1);expect((await PDFDocument.load(copy.bytes)).getPageCount()).toBe(2);
  // Export authority must match the stored original, kind, sheet and batch; cannot inject a forged native snapshot.
  await expect(tx(db,t=>t.query("INSERT INTO lab_document(batch_id,sheet_id,form,kind,revision,doc_code,template_version,snapshot,file_sha256,issued_by) SELECT batch_id,sheet_id,form,kind,99,doc_code||'-FORGED',template_version,snapshot,repeat('0',64),issued_by FROM lab_document WHERE id=$1",[pre.id]))).rejects.toThrow(/NATIVE_CONTROLLED_DOCUMENT/);
  await expect(tx(db,async t=>batch.amendSheet(t,u.certifier,{batchId:id,expectedVersion:await V(),sheetNumber:1,reason:'LOCAL TEST cannot reopen placement'}))).rejects.toThrow('PLACEMENT_LOCKED');
  const placement=(await db.query('SELECT * FROM lab_placement_snapshot WHERE batch_id=$1',[id])).rows;
  await tx(db,async t=>batch.updateSheetPlan(t,u.staff,{batchId:id,expectedVersion:await V(),sheetNumber:1,plannedWorkDate:'2026-10-24',plannedOperator:'LOCAL TEST UPDATED OPERATOR',plannedExtractionLot:'SYN-EX',plannedExtractionExpiry:'2027-01-01',plannedLibraryLot:'SYN-LIB',plannedLibraryExpiry:'2027-02-01'}));
  expect((await db.query('SELECT * FROM lab_placement_snapshot WHERE batch_id=$1',[id])).rows).toEqual(placement);
  expect((await db.query('SELECT status FROM lab_document WHERE id=$1',[pre.id])).rows[0]).toEqual({status:'Issued'});
  expect((await tx(db,t=>records.printDocument(t,u.staff,{documentId:pre.id,kind:'WORKING_COPY'},deps))).copyNumber).toBe(2);
  await tx(db,async t=>batch.startExecution(t,u.staff,{batchId:id,expectedVersion:await V(),sheetNumber:1}));
  expect((await tx(db,t=>records.readOriginal(t,u.staff,pre.id,deps))).bytes).toEqual(original.bytes);
  expect(docs.rendered).toHaveLength(0);
  await expect(db.query("UPDATE lab_document SET file_sha256=repeat('0',64) WHERE id=$1",[pre.id])).rejects.toThrow(/ISSUED_ORIGINAL_IMMUTABLE/);
 }finally{await db.close();await docs.close();}
},120000);
