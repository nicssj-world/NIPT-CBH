import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {task3Fixture,halosWorkbook,signerSetup,approveInterpretation,recordPaperRequest,T3_SOURCES} from '../helpers/task3';
import {previewHalosImport,decideHalosImport} from '../../packages/readygen/halos-import';
import {reportCandidate,finalizeReports} from '../../packages/readygen/reports';
import {uploadTemplate,testTemplate,approveTemplate,activateTemplate} from '../../packages/readygen/template-registry';
import {readArchive,writeArchive,sha256} from '../../packages/workbook/archive';
import {pdfText} from '../../packages/results/extract';
import type {Staff} from '../../packages/lab/core';

// OWNER-LAB-056 on the real thing: Microsoft Word renders the preview, finalization consumes the ACTIVE registry template (no env master,
// no rebuild), a layout revision supersedes it, issued finals keep the hash they were made with, and a layout the report reader cannot
// read back is refused. Synthetic cases and signatures; Owner masters from the protected copy. Fails (never skips) where Word is absent.
const master=(k:'SINGLETON'|'TWIN')=>readFileSync(path.join(T3_SOURCES,k==='SINGLETON'?'singleton.docx':'twin.docx'));
const retext=(from:string,to:string)=>{const parts=readArchive(master('SINGLETON'));let xml=parts.get('word/document.xml')!.toString('utf8');
 const re=new RegExp('(<w:t(?: [^>]*)?>)'+from.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(</w:t>)');if(!re.test(xml))throw Error('MUTATION_NO_MATCH '+from);
 xml=xml.replace(re,`$1${to}$2`);parts.set('word/document.xml',Buffer.from(xml));return writeArchive(parts);};

const swapTokens=(x:string,y:string)=>{const parts=readArchive(master('SINGLETON'));let xml=parts.get('word/document.xml')!.toString('utf8');
 for(const [from,to] of [[x,'@@SWAP@@'],[y,x],['@@SWAP@@',y]]){const re=new RegExp('(<w:t(?: [^>]*)?>)\\$\\{'+from+'\\}(</w:t>)');if(!re.test(xml))throw Error('MUTATION_NO_MATCH '+from);xml=xml.replace(re,'$1${'+to+'}$2');}
 parts.set('word/document.xml',Buffer.from(xml));return writeArchive(parts);};
it('Admin template: Word-verified test → independent approval → used by finalization; layout change without rebuild; issued finals keep their hash',async()=>{
 delete process.env.NIPT_REPORT_TEMPLATE_SINGLETON;delete process.env.NIPT_REPORT_TEMPLATE_TWIN;
 const f=await task3Fixture();try{
  const deps={store:f.store};                                           // NO injected templates and NO NIPT_REPORT_TEMPLATE_* path: only the registry can supply a master
  const [a,b]=f.cases;
  const bytes=halosWorkbook({result:[{sample:a.printed,ff:'14.7',gender:'Female'},{sample:b.printed,ff:'11.2',gender:'Female'}],sampleinfo:f.cases.map(x=>({id:x.vendorId,fetus:x.pregnancy,ga:'17,6'}))});
  const imp=await f.run(t=>previewHalosImport(t,f.u.staff,f.store,{name:'Sample analysis data_S990000002_10242026.xlsx',bytes}));
  await f.run(t=>decideHalosImport(t,f.u.staff,{importId:imp.id,decision:'CONFIRM',expectedRowVersion:imp.rowVersion}));
  const rowOf=(s:string)=>imp.rows.find(r=>r.sheet==='result'&&r.sampleKey===s)!.id;
  await signerSetup(f);
  await approveInterpretation(f,{interpretationApproved:true,singletonApprovedProduct:'HNZ0011',twinApprovedProduct:'HNZ0011',approvalReference:'SYNTHETIC-CLINICAL-APPROVAL-TPL'});
  for(const x of [a,b])await recordPaperRequest(f,x,'Want');
  // 0. No registry template and no installed master → the report is held, never produced from a guess.
  let cand=await f.run(t=>reportCandidate(t,f.u.certifier,deps,{rowId:rowOf(a.printed)}));expect(cand.holds.map(h=>h.code)).toContain('REPORT_MASTER_NOT_INSTALLED');
  // 1. Admin brings the Owner's Singleton master: real Word renders the preview, the PDF reads back as a report, a different person approves.
  const admin=f.admin as unknown as Staff;
  const v1=await f.run(t=>uploadTemplate(t,admin,f.store,{kind:'SINGLETON',name:'1.FM-WI-T-BM-17-07 HNZ0051-Singleton.docx',bytes:master('SINGLETON'),reason:'Owner master'}));
  expect(v1.inspection.errors).toEqual([]);
  const t1=await f.run(t=>testTemplate(t,admin,f.store,v1.id));expect(t1).toMatchObject({passed:true,pages:1});
  const preview=await f.store.get(t1.previewSha256!);expect((await pdfText(preview)).text).toContain('PREVIEW - NOT A FINAL REPORT');
  await f.run(t=>approveTemplate(t,f.u.approver as unknown as Staff,{id:v1.id,acknowledgeProductDifference:true}));
  await f.run(t=>activateTemplate(t,admin,{id:v1.id}));
  cand=await f.run(t=>reportCandidate(t,f.u.certifier,deps,{rowId:rowOf(a.printed)}));expect(cand.holds.map(h=>h.code)).not.toContain('REPORT_MASTER_NOT_INSTALLED');
  expect(cand.templateCode).toBe('FM-WI-T-BM-17-07');
  const fin1=await f.run(t=>finalizeReports(t,f.u.certifier,deps,{idempotencyKey:randomUUID(),defaults:{reportedBy:f.u.staff.id,approvedBy:f.u.certifier.id},items:[{rowId:rowOf(a.printed)}]}));
  expect(fin1.items[0].outcome).toBe('FINAL');
  const row=async(printed:string)=>(await f.db.query<{template_sha256:string;template_code:string;pdf_sha256:string}>('SELECT i.template_sha256,i.template_code,i.pdf_sha256 FROM internal_report i JOIN analytical_attempt x ON x.id=i.attempt_id WHERE x.printed_sample_id=$1',[printed])).rows[0];
  const first=await row(a.printed);expect(first).toMatchObject({template_sha256:sha256(master('SINGLETON')),template_code:'FM-WI-T-BM-17-07'});
  // 2. A layout revision (label text changed) is imported, Word-tested, approved and activated — still no rebuild/restart.
  const revB=retext('Remark:','Remarks:');
  const v2=await f.run(t=>uploadTemplate(t,admin,f.store,{kind:'SINGLETON',name:'FM-WI-T-BM-17-07 rev B.docx',bytes:revB,reason:'ปรับข้อความหัวข้อ'}));expect(v2.version).toBe(2);expect(v2.inspection.errors).toEqual([]);
  expect((await f.run(t=>testTemplate(t,admin,f.store,v2.id))).passed).toBe(true);
  await f.run(t=>approveTemplate(t,f.u.approver as unknown as Staff,{id:v2.id,acknowledgeProductDifference:true}));await f.run(t=>activateTemplate(t,admin,{id:v2.id}));
  const fin2=await f.run(t=>finalizeReports(t,f.u.certifier,deps,{idempotencyKey:randomUUID(),defaults:{reportedBy:f.u.staff.id,approvedBy:f.u.certifier.id},items:[{rowId:rowOf(b.printed)}]}));
  expect(fin2.items[0].outcome).toBe('FINAL');
  const second=await row(b.printed);expect(second.template_sha256).toBe(sha256(revB));
  expect((await pdfText(await f.store.get(second.pdf_sha256))).text).toContain('Remarks:');
  // Issued report A is untouched: still bound to revision 1's hash and its own PDF.
  expect(await row(a.printed)).toEqual(first);
  // 3. A layout the report reader cannot read back (result heading renamed) never validates, so it can never be approved or used.
  const broken=swapTokens('trisomy21_ra','trisomy18_ra');   // both placeholders still exist (inspection passes) but each sits in the other's cell
  const v3=await f.run(t=>uploadTemplate(t,admin,f.store,{kind:'SINGLETON',name:'broken.docx',bytes:broken,reason:'ทดสอบ Layout ที่อ่านกลับไม่ได้'}));
  const t3=await f.run(t=>testTemplate(t,admin,f.store,v3.id));expect(t3.passed).toBe(false);expect(t3.problems.length).toBeGreaterThan(0);
  expect((await f.db.query<{state:string}>('SELECT state FROM report_template_revision WHERE id=$1',[v3.id])).rows[0].state).toBe('Uploaded');
  await expect(f.run(t=>approveTemplate(t,f.u.approver as unknown as Staff,{id:v3.id,acknowledgeProductDifference:true}))).rejects.toMatchObject({code:'TEMPLATE_TEST_REQUIRED'});
 }finally{await f.close();}
},300000);
