import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import {histFixture,importBatch,view,confirmAll,attest,goodRow,pdfFor,csvOf,LOOKUP_KEY,type HistFixture} from '../helpers/historical';
import {syntheticCase} from '../helpers/lab';
import {createBatch,stageBatch,confirmBatch,fixRow,abandonRow,recheckBatch,readBatchPdf} from '../../packages/historical/service';
import {syntheticReportPdf} from '../../tools/his-simulator/result-pdf';
import {randomUUID} from 'node:crypto';

const codes=(r:{issues:{code:string}[]})=>r.issues.map(i=>i.code);
const count=async(f:HistFixture,sql:string)=>Number((await f.db.query<{n:string}>(sql)).rows[0].n);

describe('P5H bulk import fails closed until the Owner approves the policy (OD-18, cutoff)',()=>{
 let f:HistFixture;beforeAll(async()=>{f=await histFixture();});afterAll(async()=>{await f.close();});
 it('stages and validates rows but marks every row NotEligible; confirmation is refused; no case is created',async()=>{
  const rows=[goodRow(1),goodRow(2)];
  const batch=await importBatch(f,rows,rows.map(r=>({name:r.pdf_file!,bytes:pdfFor(r)})));
  const v=await view(f,batch);
  expect(v.ready).toBe(false);expect(v.blockers).toEqual(['ANCHOR_POLICY_NOT_CONFIGURED','CUTOFF_NOT_CONFIGURED']);
  expect(v.rows.map(r=>r.state)).toEqual(['NotEligible','NotEligible']);
  expect(v.rows[0].evaluation?.reasons.map(x=>x.code)).toEqual(['ANCHOR_POLICY_NOT_CONFIGURED','CUTOFF_NOT_CONFIGURED']);
  await expect(f.run(t=>confirmBatch(t,f.verifier,batch,LOOKUP_KEY,{idempotencyKey:randomUUID(),rows:[{draftId:v.rows[0].id,version:1,attestation:attest()}]}))).rejects.toMatchObject({code:'HISTORICAL_POLICY_NOT_CONFIGURED'});
  expect(await count(f,"SELECT count(*) n FROM nipt_case WHERE registration_origin='HISTORICAL'")).toBe(0);
 });
 it('with only the policy configured (no cutoff) it still fails closed; after both are active a re-check releases the rows',async()=>{
  await f.activate('historical_backfill',{anchorPolicy:'A_FINAL_REPORT',minimumProfile:'OD18_B_BALANCED',maxBatchRows:100});
  const rows=[goodRow(3)];
  const batch=await importBatch(f,rows,rows.map(r=>({name:r.pdf_file!,bytes:pdfFor(r)})));
  const v=await view(f,batch);expect(v.blockers).toEqual(['CUTOFF_NOT_CONFIGURED']);expect(v.rows[0].state).toBe('NotEligible');
  expect(v.rows[0].evaluation?.reasons.map(x=>x.code)).toContain('CUTOFF_NOT_CONFIGURED');
  await f.activate('go_live_cutoff',{cutoff:'2026-01-01',impactReportHash:'a'.repeat(64)});
  expect(await f.run(t=>recheckBatch(t,f.maker,batch))).toEqual({rechecked:1,ready:true});
  expect((await view(f,batch)).rows[0].state).toBe('Submitted');
 });
});

describe('P5H bulk import — 47 cases in three steps (synthetic)',()=>{
 let f:HistFixture;beforeAll(async()=>{f=await histFixture();await f.configure();},120000);afterAll(async()=>{await f.close();});
 it('uploads a table with one ZIP of 47 PDFs, stages them, and a second person confirms all 47 as one batch',async()=>{
  const rows=Array.from({length:47},(_,i)=>goodRow(i+1));
  const batch=await importBatch(f,rows,rows.map(r=>({name:r.pdf_file!,bytes:pdfFor(r)})),f.maker,{zip:true});
  const v=await view(f,batch);
  expect(v.batch.state).toBe('Staged');expect(v.ready).toBe(true);expect(v.rows).toHaveLength(47);
  expect(v.rows.every(r=>r.state==='Submitted'&&!r.issues.some(i=>i.severity==='ERROR'))).toBe(true);
  expect(v.rows[0].evaluation?.outcome).toBe('Submitted');
  expect(v.rows[0].completeness).toMatchObject({profile:'OD18_B_BALANCED',status:'COMPLETE'});
  expect(v.batch.issues).toEqual([]);
  expect((await view(f,batch,f.maker)).rows.every(r=>!r.canVerify)).toBe(true);        // the importer can never be the second person
  expect((await view(f,batch,f.verifier)).rows.every(r=>r.canVerify)).toBe(true);
  const key=randomUUID();
  const result=await confirmAll(f,batch,f.verifier,key);
  expect(result.summary).toEqual({promoted:47,alreadyPromoted:0,discrepancy:0,conflict:0,rejected:0});
  expect(await count(f,"SELECT count(*) n FROM nipt_case WHERE registration_origin='HISTORICAL'")).toBe(47);
  expect(await count(f,"SELECT count(*) n FROM case_ln l JOIN nipt_case c ON c.id=l.case_id WHERE c.registration_origin='HISTORICAL' AND l.source='HISTORICAL_DOCUMENT' AND l.verification='DOCUMENT_VERIFIED'")).toBe(47);
  expect(await count(f,"SELECT count(*) n FROM historical_record WHERE state='Verified'")).toBe(47);
  for(const t of ['his_order','specimen_round','analytical_attempt','result_report_version','result_release'])expect(await count(f,`SELECT count(*) n FROM ${t}`),t).toBe(0);
  // Replay with the same key creates nothing new.
  const again=await f.run(t=>confirmBatch(t,f.verifier,batch,LOOKUP_KEY,{idempotencyKey:key,rows:v.rows.map(r=>({draftId:r.id,version:r.version,attestation:attest()}))}));
  expect(again.summary.alreadyPromoted).toBe(47);expect(await count(f,"SELECT count(*) n FROM nipt_case WHERE registration_origin='HISTORICAL'")).toBe(47);
  // A different key cannot re-promote.
  const other=await f.run(t=>confirmBatch(t,f.verifier,batch,LOOKUP_KEY,{idempotencyKey:randomUUID(),rows:[{draftId:v.rows[0].id,version:1,attestation:attest()}]}));
  expect(other.outcomes[0]).toMatchObject({outcome:'REJECTED',code:'ALREADY_PROMOTED'});
  // Audit holds codes only.
  const details=(await f.db.query<{details:unknown}>("SELECT details FROM audit_chain WHERE action LIKE 'HIST_%'")).rows.map(r=>JSON.stringify(r.details)).join(' ');
  expect(details).not.toMatch(/2610\d{6}|SYNTHETIC PATIENT|990\d{4}/);
 },180000);
});

describe('P5H bulk import — errors are shown per row and only those rows are fixed',()=>{
 let f:HistFixture;beforeAll(async()=>{f=await histFixture();await f.configure();},120000);afterAll(async()=>{await f.close();});
 it('flags duplicate LNs, registered LNs, missing/mismatched PDFs, bad data and ineligible dates; fixes release the right rows',async()=>{
  const registered=await f.run(t=>syntheticCase(t,{staff:f.u.staff,unit:f.u.unit},{ln:'2610100099'}));
  expect(registered.caseId).toBeTruthy();
  const rows=[
   goodRow(1),                                   // 0 clean
   goodRow(2,{ln:'2610100003'}),goodRow(3),      // 1,2 duplicate LN pair (row 3 already uses 2610100003)
   goodRow(4,{pdf_file:'missing.pdf'}),          // 3 PDF not found
   goodRow(5,{hn:'12345'}),                      // 4 invalid HN
   goodRow(6,{report_date:'2026-02-01'}),        // 5 report after cutoff
   goodRow(7,{report_date:'25/12/2025'}),        // 6 day-first date refused
   goodRow(8,{ln:'2610100099'}),                 // 7 LN already registered
   goodRow(9),                                   // 8 PDF HN differs
   goodRow(10,{report_date:''}),                 // 9 no report date but PDF attached
  ];
  const pdfs=rows.map((r,i)=>({name:r.pdf_file!,bytes:i===8?pdfFor(r,{hn:'9909999'}):i===4?pdfFor(goodRow(5)):pdfFor(r)}));   // the printed PDFs carry the true values
  pdfs.push({name:'report-4.pdf',bytes:pdfFor(goodRow(4))});   // the staff later points row 4 at this file
  pdfs.push({name:'stray.pdf',bytes:syntheticReportPdf({kind:'SINGLETON',labNumber:'2699999999',hn:'9908888',collection:'10-Nov-2025'})});
  const batch=await importBatch(f,rows,pdfs.filter(p=>p.name!=='missing.pdf'));
  const v=await view(f,batch);
  const by=(n:number)=>v.rows[n];
  expect(by(0).state).toBe('Submitted');
  expect(codes(by(1))).toContain('DUPLICATE_LN_IN_BATCH');expect(codes(by(2))).toContain('DUPLICATE_LN_IN_BATCH');expect([by(1).state,by(2).state]).toEqual(['Draft','Draft']);
  expect(codes(by(3))).toContain('PDF_FILE_NOT_FOUND');
  expect(codes(by(4))).toContain('HN_INVALID');
  expect(by(5).state).toBe('NotEligible');expect(by(5).evaluation?.reasons.map(r=>r.code)).toContain('ANCHOR_NOT_BEFORE_CUTOFF');
  expect(codes(by(6))).toContain('DATE_FORMAT_INVALID');
  expect(codes(by(7))).toContain('LN_EXISTS_IN_CASE_LN');
  expect(codes(by(8))).toContain('PDF_HN_MISMATCH');
  expect(by(9).state).toBe('NotEligible');expect(by(9).evaluation?.reasons.map(r=>r.code)).toContain('ANCHOR_DATE_NOT_DAY_PRECISION');
  expect(v.batch.issues).toContainEqual({code:'PDF_NOT_USED',ref:'stray.pdf'});
  expect(v.rows.filter(r=>r.state==='Submitted')).toHaveLength(1);

  // Fix only the broken rows.
  const fix=(n:number,patch:Record<string,string>)=>f.run(t=>fixRow(t,f.maker2,f.store,by(n).id,patch,'แก้ตามต้นฉบับ'));
  expect((await fix(5,{report_date:'2025-12-15'})).state).toBe('Draft');   // the sheet now disagrees with the PDF it points to
  expect(codes((await view(f,batch)).rows[5])).toContain('PDF_REPORT_DATE_MISMATCH');
  await f.run(t=>abandonRow(t,f.maker,by(2).id,'ซ้ำกับแถวที่ 2 ยกเลิกแถวนี้'));
  const released=(await view(f,batch)).rows[1];
  expect(released.state).toBe('Submitted');expect(codes(released)).not.toContain('DUPLICATE_LN_IN_BATCH');   // sole holder of the LN is released
  expect((await fix(4,{hn:'9901005'})).state).toBe('Submitted');
  expect((await fix(3,{pdf_file:'report-4.pdf'})).state).toBe('Submitted');
  const final=await view(f,batch);
  expect(final.rows.filter(r=>r.state==='Submitted').map(r=>r.rowNo)).toEqual([2,3,5,6]);
  // Revisions are append-only and name the person who changed the row.
  expect(await count(f,"SELECT count(*) n FROM historical_draft_revision WHERE version>1")).toBeGreaterThan(0);
  await expect(f.db.query("UPDATE historical_draft_revision SET reason='x'")).rejects.toThrow(/append-only/);
  // The corrected rows now list the editor, so that person can no longer be the second person for them.
  const editor=await f.run(t=>confirmBatch(t,f.maker2,batch,LOOKUP_KEY,{idempotencyKey:randomUUID(),rows:[{draftId:by(4).id,version:2,attestation:attest()}]})).catch(e=>e);
  expect(editor).toMatchObject({code:'FORBIDDEN'});   // maker2 has no verifier role at all
 },180000);

 it('a row edited by the verifier makes that verifier a contributor and blocks their own confirmation',async()=>{
  const rows=[goodRow(21,{report_date:'2026-03-01'})];
  const batch=await importBatch(f,rows,[{name:'report-21.pdf',bytes:pdfFor(goodRow(21,{report_date:'2025-12-18'}))}]);
  const id=(await view(f,batch)).rows[0].id;
  // Give the verifier entry permission to edit (as Certifier would be), then try to confirm own edit.
  const editor={...f.verifier,roles:['HISTORICAL_VERIFIER','LAB_CERTIFIER'],permissions:['HISTORICAL_ENTRY']} as typeof f.verifier;
  await f.run(t=>fixRow(t,editor,f.store,id,{report_date:'2025-12-18'},'แก้วันที่ตามต้นฉบับ'));
  const v=(await view(f,batch,f.verifier)).rows[0];expect(v.state).toBe('Submitted');expect(v.canVerify).toBe(false);
  const out=await f.run(t=>confirmBatch(t,f.verifier,batch,LOOKUP_KEY,{idempotencyKey:randomUUID(),rows:[{draftId:id,version:v.version,attestation:attest()}]}));
  expect(out.outcomes[0]).toMatchObject({outcome:'REJECTED',code:'SELF_VERIFICATION_PROHIBITED'});
  expect(await count(f,"SELECT count(*) n FROM nipt_case WHERE registration_origin='HISTORICAL' AND id IN (SELECT promoted_case_id FROM historical_draft WHERE id IS NOT NULL)")).toBe(0);
 });
});

describe('P5H independent review, discrepancy, conflict and database guards',()=>{
 let f:HistFixture;beforeAll(async()=>{f=await histFixture();await f.configure();},120000);afterAll(async()=>{await f.close();});
 it('partial attestation outcomes are per row: discrepancy, stale version, incomplete identity; only ticked rows are touched',async()=>{
  const rows=[goodRow(31),goodRow(32),goodRow(33),goodRow(34)];
  const batch=await importBatch(f,rows,rows.map(r=>({name:r.pdf_file!,bytes:pdfFor(r)})));
  const v=await view(f,batch);
  const r=v.rows;
  const out=await f.run(t=>confirmBatch(t,f.verifier,batch,LOOKUP_KEY,{idempotencyKey:randomUUID(),rows:[
   {draftId:r[0].id,version:1,attestation:attest()},
   {draftId:r[1].id,version:1,attestation:attest({identityMatchesOriginal:false})},
   {draftId:r[2].id,version:9,attestation:attest()},
   {draftId:r[3].id,version:1,attestation:attest({identityIdentifiersChecked:['HN']})},
  ]}));
  expect(out.outcomes.map(o=>o.outcome)).toEqual(['PROMOTED','DISCREPANCY','REJECTED','REJECTED']);
  expect(out.outcomes[2].code).toBe('STALE_VERSION');expect(out.outcomes[3].code).toBe('IDENTITY_NEEDS_TWO_INDEPENDENT_IDENTIFIERS');
  const after=await view(f,batch);
  expect(after.rows.map(x=>x.state)).toEqual(['Promoted','Discrepancy','Submitted','Submitted']);
  expect(codes(after.rows[1])).toContain('REVIEW_MISMATCH_IDENTITY');
  // Discrepancy → correct → resubmitted automatically → second person confirms again.
  await f.run(t=>fixRow(t,f.maker,f.store,r[1].id,{name:'SYNTHETIC PATIENT 32'},'แก้ชื่อตามต้นฉบับ'));
  expect((await view(f,batch)).rows[1].state).toBe('Submitted');
  const again=await confirmAll(f,batch);
  expect(again.summary.promoted).toBe(3);
  expect(await count(f,"SELECT count(*) n FROM historical_verification WHERE result='DISCREPANCY'")).toBe(1);
 });
 it('an LN registered after staging turns the draft into a Conflict and creates nothing',async()=>{
  const rows=[goodRow(41),goodRow(42)];
  const batch=await importBatch(f,rows,rows.map(r=>({name:r.pdf_file!,bytes:pdfFor(r)})));
  await f.run(t=>syntheticCase(t,{staff:f.u.staff,unit:f.u.unit},{ln:rows[0].ln}));
  const before=await count(f,"SELECT count(*) n FROM nipt_case WHERE registration_origin='HISTORICAL'");
  const out=await confirmAll(f,batch);
  expect(out.outcomes.map(o=>o.outcome)).toEqual(['CONFLICT','PROMOTED']);
  expect(out.outcomes[0].reasons?.map(x=>x.code)).toContain('LN_EXISTS_IN_CASE_LN');
  expect(await count(f,"SELECT count(*) n FROM nipt_case WHERE registration_origin='HISTORICAL'")).toBe(before+1);
  expect((await view(f,batch)).rows[0].state).toBe('Conflict');
  // A Conflict draft is terminal: it cannot be edited, abandoned or promoted later.
  await expect(f.run(t=>abandonRow(t,f.maker,(batchRowId(out)),'ยกเลิกแถวที่ขัดแย้ง'))).rejects.toMatchObject({code:'ROW_NOT_EDITABLE'});
 });
 it('rejects a verifier without the role and a maker without HISTORICAL_ENTRY',async()=>{
  const rows=[goodRow(51)];
  const batch=await importBatch(f,rows,rows.map(r=>({name:r.pdf_file!,bytes:pdfFor(r)})));
  const id=(await view(f,batch)).rows[0].id;
  await expect(f.run(t=>confirmBatch(t,f.u.certifier,batch,LOOKUP_KEY,{idempotencyKey:randomUUID(),rows:[{draftId:id,version:1,attestation:attest()}]}))).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(f.run(t=>createBatch(t,{...f.maker,permissions:[]},f.store,{table:{name:'x.csv',bytes:csvOf([goodRow(52)])},files:[]}))).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(f.run(t=>createBatch(t,f.u.anc as never,f.store,{table:{name:'x.csv',bytes:csvOf([goodRow(52)])},files:[]}))).rejects.toMatchObject({code:'FORBIDDEN'});
 });
 it('database guards: no direct case, no promotion without a second-person verification, no self-verification, promoted drafts are frozen',async()=>{
  const rows=[goodRow(61)];
  const batch=await importBatch(f,rows,rows.map(r=>({name:r.pdf_file!,bytes:pdfFor(r)})));
  const d=(await f.db.query<{id:string;version:number;contributor_ids:string[]}>("SELECT id,version,contributor_ids FROM historical_draft WHERE batch_id=$1",[batch])).rows[0];
  await expect(f.db.query("INSERT INTO nipt_case(registration_origin,identity_key) VALUES('HISTORICAL',$1)",['c'.repeat(64)])).rejects.toThrow(/historical promotion disabled/);
  await expect(f.db.query("SELECT historical_promote($1,$2,$3,$4)",[d.id,randomUUID(),'d'.repeat(64),'k'.repeat(20)])).rejects.toThrow(/HISTORICAL_VERIFICATION_REQUIRED/);
  await expect(f.db.query("INSERT INTO historical_verification(draft_id,draft_version,verifier_id,result,attestation,batch_key) VALUES($1,$2,$3,'CONFIRMED','{}','k'||repeat('x',20))",[d.id,d.version,d.contributor_ids[0]])).rejects.toThrow(/HISTORICAL_SELF_VERIFICATION/);
  await expect(f.db.query("INSERT INTO historical_verification(draft_id,draft_version,verifier_id,result,attestation,batch_key) VALUES($1,$2,$3,'CONFIRMED','{}','k'||repeat('x',20))",[d.id,d.version,f.u.staff2.id])).rejects.toThrow(/HISTORICAL_VERIFIER_ROLE_REQUIRED/);
  await expect(f.db.query("UPDATE historical_draft SET state='Promoted',promoted_case_id=NULL WHERE id=$1",[d.id])).rejects.toThrow();
  await expect(f.db.query("UPDATE historical_draft SET state='Abandoned' WHERE id=$1",[d.id])).rejects.toThrow(/ILLEGAL_TRANSITION/);   // Submitted cannot be abandoned
  const out=await confirmAll(f,batch);expect(out.summary.promoted).toBe(1);
  await expect(f.db.query("UPDATE historical_draft SET issues='[]' WHERE id=$1",[d.id])).rejects.toThrow(/PROMOTED_IMMUTABLE/);
  const c=(await f.db.query<{id:string}>("SELECT promoted_case_id id FROM historical_draft WHERE id=$1",[d.id])).rows[0].id;
  await expect(f.db.query("UPDATE nipt_case SET registration_origin='ANC' WHERE id=$1",[c])).rejects.toThrow(/immutable origin/);
  await expect(f.db.query("UPDATE case_ln SET verification='VERIFIED_BY_PET' WHERE case_id=$1",[c])).rejects.toThrow(/PET/);
  const ln=(await f.db.query<{id:string}>("SELECT id FROM case_ln WHERE case_id=$1",[c])).rows[0].id;
  await expect(f.db.query("INSERT INTO specimen_round(case_id,case_ln_id,round_number) VALUES($1,$2,1)",[c,ln])).rejects.toThrow(/historical downstream prohibited/);
  await expect(f.db.query("INSERT INTO case_ln(case_id,ln,source,verification) VALUES((SELECT id FROM nipt_case WHERE registration_origin='ANC' LIMIT 1),'2699000001','HISTORICAL_DOCUMENT','DOCUMENT_VERIFIED')")).rejects.toThrow();
  // The verified PDF is readable only through the access-logged reader.
  const file=(await f.db.query<{id:string}>("SELECT id FROM historical_batch_file WHERE batch_id=$1 AND role='PDF'",[batch])).rows[0].id;
  const pdf=await f.run(t=>readBatchPdf(t,f.verifier,f.store,batch,file));
  expect(pdf.bytes.subarray(0,5).toString()).toBe('%PDF-');
  expect(await count(f,"SELECT count(*) n FROM audit_chain WHERE action='HIST_FILE_VIEWED'")).toBe(1);
  await expect(f.run(t=>readBatchPdf(t,f.u.anc as never,f.store,batch,file))).rejects.toMatchObject({code:'FORBIDDEN'});
 });
 it('upload problems become file or batch findings, not crashes',async()=>{
  const rows=[goodRow(71)];
  const bad=Buffer.from('not a pdf at all');
  const {batchId}=await f.run(t=>createBatch(t,f.maker,f.store,{table:{name:'h.csv',bytes:csvOf(rows)},files:[{name:'report-71.pdf',bytes:pdfFor(rows[0])},{name:'notes.txt',bytes:bad}],idempotencyKey:randomUUID()}));
  await f.run(t=>stageBatch(t,f.store,batchId,f.maker.id));
  const v=await view(f,batchId);expect(v.batch.issues).toContainEqual({code:'FILE_REJECTED_NOT_A_PDF',ref:'notes.txt'});expect(v.rows[0].state).toBe('Submitted');
  const unknown=await f.run(t=>createBatch(t,f.maker,f.store,{table:{name:'h.csv',bytes:Buffer.from('ln,hn\r\n1,2\r\n')},files:[],idempotencyKey:randomUUID()}));
  await f.run(t=>stageBatch(t,f.store,unknown.batchId,f.maker.id));
  const failed=(await f.db.query<{state:string;error_code:string}>('SELECT state,error_code FROM historical_batch WHERE id=$1',[unknown.batchId])).rows[0];
  expect(failed).toEqual({state:'Failed',error_code:'TABLE_MISSING_COLUMN'});
  await expect(f.run(t=>createBatch(t,f.maker,f.store,{table:{name:'h.pdf',bytes:csvOf(rows)},files:[]}))).rejects.toMatchObject({code:'TABLE_TYPE_NOT_SUPPORTED'});
  const key=randomUUID();
  const one=await f.run(t=>createBatch(t,f.maker,f.store,{table:{name:'h.csv',bytes:csvOf([goodRow(72)])},files:[],idempotencyKey:key}));
  const two=await f.run(t=>createBatch(t,f.maker,f.store,{table:{name:'h.csv',bytes:csvOf([goodRow(72)])},files:[],idempotencyKey:key}));
  expect(two).toMatchObject({batchId:one.batchId,replayed:true});
  await expect(f.run(t=>createBatch(t,f.maker2,f.store,{table:{name:'h.csv',bytes:csvOf([goodRow(72)])},files:[],idempotencyKey:key}))).rejects.toMatchObject({code:'IDEMPOTENCY_KEY_REUSED'});
 });
});

function batchRowId(out:{outcomes:{draftId:string}[]}){return out.outcomes[0].draftId;}

describe('P5H least-privilege database roles',()=>{
 it('the web role uploads and confirms, the worker role stages without reading P2 payloads, and a same-HN patient with a different name blocks only at confirmation',async()=>{
  const f=await histFixture();
  try{
   await f.configure();
   const {readFile}=await import('node:fs/promises');
   // An existing current patient who shares the HN of row 82 but has another name and date of birth.
   const rows=[goodRow(81),goodRow(82)];
   const other=await f.run(t=>syntheticCase(t,{staff:f.u.staff,unit:f.u.unit}));
   await f.db.query("INSERT INTO p2_case_identity(case_id,hn) VALUES($1,$2)",[other.caseId,rows[1].hn]);
   await f.db.query("INSERT INTO p2_document_revision(case_id,round_id,kind,version,template_version,payload,content_hash,reason,created_by) VALUES($1,$2,'REQUEST',1,'SYNTHETIC-FM01-v1',$3,$4,'SYNTHETIC_P5H',$5)",[other.caseId,other.roundId,JSON.stringify({patient:{syntheticName:'SYNTHETIC OTHER PERSON',dob:'1980-01-01'}}),'e'.repeat(64),f.u.staff.id]);
   await f.db.exec(await readFile('packages/db/roles.sql','utf8'));
   await f.db.exec('SET ROLE app_rw');
   const {batchId}=await f.run(t=>createBatch(t,f.maker,f.store,{table:{name:'h.csv',bytes:csvOf(rows)},files:rows.map(r=>({name:r.pdf_file!,bytes:pdfFor(r)})),idempotencyKey:randomUUID()}));
   await f.db.exec('RESET ROLE;SET ROLE worker_rw');
   await f.run(t=>stageBatch(t,f.store,batchId,f.maker.id));
   await expect(f.db.query("SELECT payload FROM p2_document_revision")).rejects.toThrow(/permission denied/);
   await expect(f.db.query("INSERT INTO historical_verification(draft_id,draft_version,verifier_id,result,attestation,batch_key) SELECT id,version,$1,'CONFIRMED','{}','kkkkkkkkkkkkkkkkkkkk' FROM historical_draft",[f.verifier.id])).rejects.toThrow(/permission denied/);
   await expect(f.db.query("DELETE FROM historical_draft")).rejects.toThrow(/permission denied/);
   await f.db.exec('RESET ROLE;SET ROLE app_rw');
   const staged=await view(f,batchId);
   expect(staged.rows.map(r=>r.state)).toEqual(['Submitted','Submitted']);
   expect(staged.rows[1].issues).toContainEqual(expect.objectContaining({code:'HN_ONLY_MATCH_NOT_LINKED',severity:'WARN'}));   // not comparable for the worker: shown to the reviewer, never linked
   const out=await confirmAll(f,batchId);
   expect(out.outcomes.map(o=>o.outcome)).toEqual(['PROMOTED','CONFLICT']);
   expect(out.outcomes[1].reasons?.map(x=>x.code)).toContain('IDENTITY_CONFLICT_SAME_HN');   // the web role can compare name and DOB
   await expect(f.db.query("UPDATE historical_eligibility_evaluation SET outcome='Submitted'")).rejects.toThrow(/permission denied|append-only/);
   await f.db.exec('RESET ROLE');
  }finally{await f.close();}
 },120000);
});
