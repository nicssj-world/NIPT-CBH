import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {testDatabase} from '../helpers/database';
import {tx,labUsers,setPendingPolicy,syntheticCase,receiveS1,attemptOf,version,docDeps} from '../helpers/lab';
import * as batch from '../../packages/lab/batch';
import {workbookWorkspace,saveWorkbookDraft,exportWorkbook} from '../../packages/workbook/service';
import {exportTaskPdfs} from '../../packages/workbook/native-pdf';
import {SHEETS} from '../../packages/workbook/master';

it.skipIf(process.env.NIPT_TASK1_NATIVE_VERIFY!=='yes')('Task1 locked metadata regenerates latest native PDF without changing frozen source or draft revision',async()=>{
 const db=await testDatabase(),docs=await docDeps();try{
  const u=await labUsers(db);await setPendingPolicy(db,u,'PROCEED_SYNTHETIC_LABELLED');
  const c=await tx(db,t=>syntheticCase(t,u));await tx(db,t=>receiveS1(t,c));const a=await attemptOf(db,c.roundId);
  const b=await tx(db,t=>batch.createBatch(t,u.staff)),id=b.batchId,V=()=>version(db,id);
  await tx(db,t=>batch.assignExact(t,u.staff,{batchId:id,expectedVersion:0,attemptId:a.id,slot:8,mode:'MANUAL'}));
  const original={plannedWorkDate:'2026-10-23',plannedOperator:'SYNTHETIC ORIGINAL',plannedExtractionLot:'EX-A',plannedExtractionExpiry:'2026-12-01',plannedLibraryLot:'LIB-A',plannedLibraryExpiry:'2026-12-02'};
  await tx(db,async t=>batch.updateSheetPlan(t,u.staff,{batchId:id,expectedVersion:await V(),sheetNumber:1,...original}));
  await tx(db,async t=>batch.planCheck(t,u.staff,{batchId:id,expectedVersion:await V(),sheetNumber:1,confirm:{controlsAtTemplate:true,identifiersMatch:true,noDuplicates:true}}));
  await tx(db,async t=>batch.finalizeSheet(t,u.staff,{batchId:id,expectedVersion:await V(),sheetNumber:1}));
  const deps={master:readFileSync('.local/lab-owner-evidence/lab-combined-master.xlsx'),store:docs.deps.store,render:exportTaskPdfs};
  const before=await tx(db,t=>workbookWorkspace(t,u.staff,id,deps));
  const draft=await tx(db,t=>saveWorkbookDraft(t,u.staff,{batchId:id,expectedVersion:before.version,expectedRevision:0,values:before.values},deps));
  const frozen=(await db.query('SELECT content_hash,payload FROM lab_placement_snapshot WHERE batch_id=$1',[id])).rows;
  const oldXlsx=await tx(db,t=>exportWorkbook(t,u.staff,{batchId:id,revision:draft.revision,format:'XLSX'},deps));
  const next={plannedWorkDate:'2026-10-24',plannedOperator:'SYNTHETIC LATEST',plannedExtractionLot:'EX-B',plannedExtractionExpiry:'2027-01-01',plannedLibraryLot:'LIB-B',plannedLibraryExpiry:'2027-02-01'};
  await tx(db,async t=>batch.updateSheetPlan(t,u.staff,{batchId:id,expectedVersion:await V(),sheetNumber:1,...next}));
  const after=await tx(db,t=>workbookWorkspace(t,u.staff,id,deps));expect(after.sourceStale).toBe(false);expect(after.sourceSha256).toBe(before.sourceSha256);expect(after.draft!.revision).toBe(draft.revision);
  expect((await db.query('SELECT content_hash,payload FROM lab_placement_snapshot WHERE batch_id=$1',[id])).rows).toEqual(frozen);
  const pdf=await tx(db,t=>exportWorkbook(t,u.staff,{batchId:id,revision:draft.revision,format:'PDF',sheet:SHEETS[0]},deps));
  const xlsx=await tx(db,t=>exportWorkbook(t,u.staff,{batchId:id,revision:draft.revision,format:'XLSX'},deps));
  expect(pdf.manifest.xlsxSha256).toBe(xlsx.sha256);expect(xlsx.sha256).not.toBe(oldXlsx.sha256);
  const loading=getDocument({data:new Uint8Array(pdf.bytes),useSystemFonts:false}),document=await loading.promise;let text='';
  try{for(let n=1;n<=document.numPages;n++){const page=await document.getPage(n),content=await page.getTextContent();text+=content.items.map(i=>'str' in i?i.str:'').join(' ');}}finally{await loading.destroy();}
  for(const value of ['24/10/2569','SYNTHETIC LATEST','EX-B / 01/01/2570','LIB-B / 01/02/2570'])expect(text).toContain(value);
  expect(text).not.toContain('SYNTHETIC ORIGINAL');
  const root='.local/task1-owner-20261023/exports';await mkdir(root,{recursive:true});await writeFile(root+'/service-latest-metadata.pdf',pdf.bytes);await writeFile(root+'/service-latest-metadata.xlsx',xlsx.bytes);
  await writeFile(root+'/service-latest-metadata.json',JSON.stringify({syntheticOnly:true,sourceHashBefore:before.sourceSha256,sourceHashAfter:after.sourceSha256,frozenPlacement:frozen,revisionBefore:draft.revision,revisionAfter:after.draft!.revision,pdf:pdf.manifest,xlsx: xlsx.manifest,pdfText:text},null,2));
 }finally{await db.close();await docs.close();}
},180000);
