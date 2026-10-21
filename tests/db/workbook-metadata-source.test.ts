import {it,expect,vi,afterEach} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import {PDFDocument} from 'pdf-lib';
import {testDatabase} from '../helpers/database';
import {tx,labUsers,setPendingPolicy,syntheticCase,receiveS1,docDeps,attemptOf,version} from '../helpers/lab';
import * as batch from '../../packages/lab/batch';
import * as records from '../../packages/lab/records';
import {workbookWorkspace,saveWorkbookDraft,exportWorkbook} from '../../packages/workbook/service';
import {issueNativeWorkbook} from '../../packages/workbook/controlled';
import {SHEETS,MASTER_SHA256} from '../../packages/workbook/master';
import {readArchive,sha256} from '../../packages/workbook/archive';
import {staleMetadataInventory} from '../../tools/p0/stale-metadata-core';

// Plan Rev 3.4 §5.1: Task metadata (B4/B5/K5/B16/B17) has one owner, the Lab source. Enforced server-side,
// including direct API calls and stale drafts saved before this rule existed; history is never rewritten.
const masterPath=process.env.NIPT_TASK_MASTER_PATH??'.local/lab-owner-evidence/lab-combined-master.xlsx';
afterEach(()=>vi.unstubAllEnvs());
const xlsxText=(bytes:Buffer)=>{const parts=readArchive(bytes);return (parts.get('xl/worksheets/sheet1.xml')!.toString())+(parts.get('xl/sharedStrings.xml')?.toString()??'');};

it.skipIf(!existsSync(masterPath))('workbook Task metadata is source-owned: direct API, stale drafts, controlled issue, amendment',async()=>{
 const db=await testDatabase(),u=await labUsers(db),docs=await docDeps();
 const render=async()=>{const d=await PDFDocument.create();d.addPage([595.28,841.89]);d.addPage([595.28,841.89]);const bytes=Buffer.from(await d.save());
  return SHEETS.map(sheet=>({sheet,bytes,sha256:sha256(bytes),pageCount:2,pages:[],formulaCount:0,formulaErrors:[],poolingCalculation:null,renderer:'Microsoft Excel' as const,goldenFidelityVerified:false}));};
 const wb={master:readFileSync(masterPath),store:docs.deps.store,render} as unknown as Parameters<typeof workbookWorkspace>[3];
 try{
  await setPendingPolicy(db,u,'PROCEED_SYNTHETIC_LABELLED');
  const c=await tx(db,t=>syntheticCase(t,u));await tx(db,t=>receiveS1(t,c));const a=await attemptOf(db,c.roundId);
  const b=await tx(db,t=>batch.createBatch(t,u.staff)),id=b.batchId,V=()=>version(db,id);
  await tx(db,t=>batch.assignToBatch(t,u.staff,{batchId:id,expectedVersion:0,attemptIds:[a.id]}));
  const finalize=async(operator:string|null)=>{
   await tx(db,async t=>batch.updateSheetPlan(t,u.staff,{batchId:id,expectedVersion:await V(),sheetNumber:1,plannedWorkDate:'2026-10-15',plannedOperator:operator,plannedExtractionLot:null,plannedExtractionExpiry:'2026-12-31',plannedLibraryLot:null,plannedLibraryExpiry:null}));
   await tx(db,async t=>batch.planCheck(t,u.staff,{batchId:id,expectedVersion:await V(),sheetNumber:1,confirm:{controlsAtTemplate:true,identifiersMatch:true,noDuplicates:true}}));
   await tx(db,async t=>batch.finalizeSheet(t,u.staff,{batchId:id,expectedVersion:await V(),sheetNumber:1}));
  };
  await finalize(null);
  // Source emits every key for the finalized Task: blank operator, BE date, expiry without lot is shown, not dropped.
  const ws=await tx(db,t=>workbookWorkspace(t,u.staff,id,wb));
  expect(ws.values['task.1.operator']).toBe('');expect(ws.values['task.1.date']).toBe('15/10/2569');
  expect(ws.values['task.1.extractionLotExp']).toBe('— / 31/12/2569');expect(ws.values['task.1.libraryLotExp']).toBe('');
  expect('task.2.date' in ws.values).toBe(false); // TL2 not finalized: no metadata in the workbook
  // Direct API: every Task metadata key is refused, whether the source value is blank, present or absent.
  for(const values of [{'task.1.operator':'TYPED'},{'task.1.date':'01/01/2569'},{'task.1.run':'Run999/2026'},{'task.1.extractionLotExp':'X / 1'},{'task.1.libraryLotExp':'Y / 2'},{'task.2.operator':'TL2 NOT FINALIZED'}])
   await expect(tx(db,t=>saveWorkbookDraft(t,u.staff,{batchId:id,expectedVersion:ws.version,expectedRevision:0,values},wb))).rejects.toThrow('TASK_SOURCE_FIELD_READ_ONLY');
  // A stale draft saved before the rule (source had no operator key) — written directly, as an old revision would be.
  await db.query('INSERT INTO task_workbook_revision(batch_id,revision,master_sha256,source_sha256,source_snapshot,values,created_by) VALUES($1,1,$2,$3,$4,$5,$6)',
   [id,MASTER_SHA256,ws.sourceSha256,'{}',JSON.stringify({...ws.values,'task.1.operator':'OLD OPERATOR','task.1.extractionLotExp':'OLD LOT / x','task.2.operator':'OLD TL2'}),u.staff.id]);
  const stale=await tx(db,t=>workbookWorkspace(t,u.staff,id,wb));
  expect(stale.sourceStale).toBe(true);expect(stale.values['task.1.operator']).toBe('');expect(stale.values['task.1.extractionLotExp']).toBe('— / 31/12/2569');expect('task.2.operator' in stale.values).toBe(false);
  await expect(tx(db,t=>exportWorkbook(t,u.staff,{batchId:id,revision:1,format:'XLSX'},wb))).rejects.toThrow('TASK_METADATA_SOURCE_MISMATCH');
  // Rebind = save a new revision from the sanitized workspace; the export then carries only source values.
  const rebound=await tx(db,t=>saveWorkbookDraft(t,u.staff,{batchId:id,expectedVersion:stale.version,expectedRevision:1,values:stale.values},wb));
  const out=await tx(db,t=>exportWorkbook(t,u.staff,{batchId:id,revision:rebound.revision,format:'XLSX'},wb));
  const text=xlsxText(out.bytes);expect(text).not.toContain('OLD');expect(text).toContain('15/10/2569');expect(text).toContain('— / 31/12/2569');
  // History is preserved: the stale revision row is untouched.
  expect((await db.query<{v:Record<string,unknown>}>('SELECT values v FROM task_workbook_revision WHERE batch_id=$1 AND revision=1',[id])).rows[0].v['task.1.operator']).toBe('OLD OPERATOR');
  // Controlled native issue after another stale write still issues from the source, never from the stale draft.
  await db.query('INSERT INTO task_workbook_revision(batch_id,revision,master_sha256,source_sha256,source_snapshot,values,created_by) VALUES($1,3,$2,$3,$4,$5,$6)',
   [id,MASTER_SHA256,ws.sourceSha256,'{}',JSON.stringify({...ws.values,'task.1.operator':'OLD AGAIN'}),u.staff.id]);
  vi.stubEnv('NIPT_MODE','operational');vi.stubEnv('APP_ORIGIN','https://nipt.test');await db.query("UPDATE nipt_runtime_config SET mode='operational'");
  const deps={...docs.deps,native:(t:Parameters<typeof issueNativeWorkbook>[0],user:Parameters<typeof issueNativeWorkbook>[1],input:Parameters<typeof issueNativeWorkbook>[2])=>issueNativeWorkbook(t,user,input,wb)};
  const pre=await tx(db,async t=>records.issuePreWork(t,u.staff,{batchId:id,expectedVersion:await V(),sheetNumber:1},deps));
  const snap=(await db.query<{snapshot:{workbookRevision:number}}>('SELECT snapshot FROM lab_document WHERE id=$1',[pre.id])).rows[0].snapshot;
  const issued=(await db.query<{v:Record<string,unknown>}>('SELECT values v FROM task_workbook_revision WHERE batch_id=$1 AND revision=$2',[id,snap.workbookRevision])).rows[0].v;
  expect(issued['task.1.operator']).toBe('');expect(JSON.stringify(issued)).not.toContain('OLD');
  // Amendment changes the planned operator: a pre-amendment draft can no longer be exported.
  await tx(db,async t=>batch.amendSheet(t,u.certifier,{batchId:id,expectedVersion:await V(),sheetNumber:1,reason:'LOCAL TEST revise plan'}));
  await finalize('NEW OPERATOR');
  await expect(tx(db,t=>exportWorkbook(t,u.staff,{batchId:id,revision:snap.workbookRevision,format:'XLSX'},wb))).rejects.toThrow(/TASK_SOURCE_CHANGED_REBIND_REQUIRED|TASK_METADATA_SOURCE_MISMATCH/);
  expect((await tx(db,t=>workbookWorkspace(t,u.staff,id,wb))).values['task.1.operator']).toBe('NEW OPERATOR');
  // The read-only inventory (tools/p0) flags exactly the seeded stale values and no issued document built from them.
  const inv=await staleMetadataInventory(db);
  // (The stale lot text "OLD LOT / x" sits beside a planned expiry, so only operator/TL2 are provably not source-supplied.)
  expect(inv.findings.map(f=>`${f.revision}:${f.key}:${f.reason}`).sort()).toEqual([
   '1:task.1.operator:VALUE_NOT_FROM_LAB_SOURCE','1:task.2.operator:TASK_NOT_FINALIZED_AT_REVISION','3:task.1.operator:VALUE_NOT_FROM_LAB_SOURCE']);
  expect(inv.affectedIssuedDocuments).toEqual([]);
 }finally{await db.close();await docs.close();}
},180000);
