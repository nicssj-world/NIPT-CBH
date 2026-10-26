import {describe,it,expect,beforeEach,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase,addUser} from '../helpers/database';
import {tx} from '../helpers/lab';
import {FileStore} from '../../packages/storage';
import {readArchive,writeArchive,sha256} from '../../packages/workbook/archive';
import type {Queryable} from '../../packages/db/connection';
import type {Staff} from '../../packages/lab/core';
import {inspectTemplate,uploadTemplate,testTemplate,approveTemplate,rejectTemplate,activateTemplate,templateOverview,activeTemplate} from '../../packages/readygen/template-registry';
import {TEMPLATES} from '../../packages/readygen/interpretation';
import {TOKENS} from '../../packages/readygen/docx';

// OWNER-LAB-056: Admin-managed ReadyGen-style templates — inspection, preview-verified test, independent approval, activation,
// immutability, and fail-closed behaviour. Uses the Owner's real Word masters; Word rendering is stubbed here (native test covers it).
const SRC='.local/task3-sources';
const master=(k:'SINGLETON'|'TWIN')=>readFileSync(path.join(SRC,k==='SINGLETON'?'singleton.docx':'twin.docx'));
const NAME={SINGLETON:'1.FM-WI-T-BM-17-07 HNZ0051-Singleton.docx',TWIN:'2.FM-WI-T-BM-17-08 HNZ0051-Twin.docx'};
/** A DOCX variant: edit word/document.xml (or another part) of the Owner's master. */
function variant(k:'SINGLETON'|'TWIN',edit:(parts:Map<string,Buffer>)=>void){const parts=readArchive(master(k));edit(parts);return writeArchive(parts);}
const editXml=(part:string,fn:(xml:string)=>string)=>(parts:Map<string,Buffer>)=>parts.set(part,Buffer.from(fn(parts.get(part)!.toString('utf8'))));
// The Owner's masters split every placeholder across several Word runs (`${` + `patientName` + `}`), so edits work on whole text nodes and
// must match: a no-op mutation would let a test pass for the wrong reason.
const retext=(part:string,from:string,to:string,all=false)=>editXml(part,x=>{const re=new RegExp('(<w:t(?: [^>]*)?>)'+from.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(</w:t>)','g');if(!re.test(x))throw Error('MUTATION_NO_MATCH '+from);
 return x.replace(new RegExp(re.source,all?'g':''),`$1${to}$2`);});
const addParagraph=(text:string)=>editXml('word/document.xml',x=>{const at=x.lastIndexOf('<w:sectPr');if(at<0)throw Error('MUTATION_NO_SECTPR');return x.slice(0,at)+`<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`+x.slice(at);});

describe('inspection (pure)',()=>{
 it('the Owner masters inspect clean: every ReadyGen placeholder present, code matches, product read from the file name',()=>{
  for(const k of ['SINGLETON','TWIN'] as const){const i=inspectTemplate(k,master(k),NAME[k]);
   expect(i.errors).toEqual([]);expect(i.missing).toEqual([]);expect(i.unknown).toEqual([]);expect(i.ambiguous).toEqual([]);
   expect(i.code).toBe(TEMPLATES[k].code);expect(i.product).toBe('HNZ0051');expect([...TOKENS[k]].every(t=>i.found.includes(t))).toBe(true);}
 });
 it('unknown placeholder is named with a suggestion; missing and ambiguous syntax are errors; nothing is silently accepted',()=>{
  const typo=inspectTemplate('SINGLETON',variant('SINGLETON',retext('word/document.xml','patientName','patientNam')));
  expect(typo.errors.map(e=>e.code)).toContain('TEMPLATE_UNKNOWN_PLACEHOLDER');expect(typo.unknown).toEqual([{token:'patientNam',suggestion:'patientName'}]);expect(typo.missing).toContain('patientName');
  const wrongCase=inspectTemplate('SINGLETON',variant('SINGLETON',retext('word/document.xml','hn','HN')));expect(wrongCase.unknown[0]).toEqual({token:'HN',suggestion:'hn'});
  const spaced=inspectTemplate('SINGLETON',variant('SINGLETON',addParagraph('$ {hn}')));
  expect(spaced.errors.map(e=>e.code)).toContain('TEMPLATE_AMBIGUOUS_PLACEHOLDER_SYNTAX');expect(spaced.missing).toEqual([]);
  const braces=inspectTemplate('SINGLETON',variant('SINGLETON',addParagraph('{ga}')));expect(braces.ambiguous.length).toBeGreaterThan(0);
  const dashed=inspectTemplate('SINGLETON',variant('SINGLETON',addParagraph('${sample-id}')));expect(dashed.errors.map(e=>e.code)).toContain('TEMPLATE_AMBIGUOUS_PLACEHOLDER_SYNTAX');
 });
 it('a Twin file is not accepted as a Singleton (and vice versa): the controlled form code and placeholder set differ',()=>{
  const asSingleton=inspectTemplate('SINGLETON',master('TWIN'));expect(asSingleton.errors.map(e=>e.code)).toEqual(expect.arrayContaining(['TEMPLATE_DOCUMENT_CODE_MISMATCH','TEMPLATE_PLACEHOLDER_MISSING']));
  const asTwin=inspectTemplate('TWIN',master('SINGLETON'));expect(asTwin.errors.map(e=>e.code)).toContain('TEMPLATE_DOCUMENT_CODE_MISMATCH');expect(asTwin.unknown.length).toBeGreaterThan(0);
 });
 it('macros / embedded code, non-DOCX bytes, oversize and a removed signature slot are refused',()=>{
  expect(inspectTemplate('SINGLETON',variant('SINGLETON',p=>p.set('word/vbaProject.bin',Buffer.from('x')))).errors.map(e=>e.code)).toContain('TEMPLATE_HAS_MACROS_OR_EMBEDDED_CODE');
  expect(inspectTemplate('SINGLETON',Buffer.from('not a docx at all')).errors.map(e=>e.code)).toEqual(['TEMPLATE_NOT_DOCX']);
  expect(inspectTemplate('SINGLETON',Buffer.alloc(5*1024*1024+1)).errors.map(e=>e.code)).toEqual(['TEMPLATE_TOO_LARGE']);
  const noReported=inspectTemplate('SINGLETON',variant('SINGLETON',retext('word/document.xml','Reported b','Prepared b',true)));
  expect(noReported.errors.map(e=>e.code)).toContain('TEMPLATE_STRUCTURE_INCOMPATIBLE');
  const codeGone=inspectTemplate('SINGLETON',variant('SINGLETON',retext('word/header1.xml','Fm-WI-T-BM17-07','Form')));expect(codeGone.errors.map(e=>e.code)).toContain('TEMPLATE_DOCUMENT_CODE_MISSING');
  const hnz11=inspectTemplate('SINGLETON',master('SINGLETON'),'x HNZ0011-Singleton.docx');expect(hnz11.product).toBe('HNZ0011');
 });
});

describe('lifecycle (PGlite)',()=>{
 let db:PGlite,store:FileStore,dir:string,admin:Staff,admin2:Staff,approver:Staff,lab:Staff;
 beforeEach(async()=>{db=await testDatabase();dir=await mkdtemp(path.join(os.tmpdir(),'nipt-tpl-'));store=new FileStore(dir);
  admin=await addUser(db,'APP_ADMIN','synthetic.tpl.admin') as Staff;admin2=await addUser(db,'APP_ADMIN','synthetic.tpl.admin2') as Staff;
  approver=await addUser(db,'CLINICAL_APPROVER','synthetic.tpl.approver') as Staff;lab=await addUser(db,'LAB_STAFF','synthetic.tpl.lab') as Staff;});
 afterEach(async()=>{await db.close();await rm(dir,{recursive:true,force:true});});
 const q=()=>db as unknown as Queryable;const run=<T>(fn:(t:Queryable)=>Promise<T>)=>tx(q(),fn);
 // watermark() needs a real PDF; give the stub renderer a minimal valid one.
 async function pdf(){const {PDFDocument}=await import('pdf-lib');const d=await PDFDocument.create();d.addPage([595,842]);return Buffer.from(await d.save());}
 async function deps(ok=true){const bytes=await pdf();return {render:async(items:{id:string;docx:Buffer}[])=>items.map(i=>({id:i.id,bytes,sha256:sha256(bytes),pages:1,renderer:'Microsoft Word' as const})),
  verify:async()=>ok?{ok:true,problems:[] as string[],parsed:{} as never}:{ok:false,problems:['TRISOMY','SCA'],parsed:{} as never}};}
 const upload=(u:Staff,kind:'SINGLETON'|'TWIN',bytes:Buffer,name=NAME[kind],reason='ปรับ Layout ตามแบบฟอร์มล่าสุด')=>run(t=>uploadTemplate(t,u,store,{kind,name,bytes,reason}));

 it('upload → preview test → independent approval (product difference acknowledged) → activate; the Owner master stays the fallback until then',async()=>{
  expect(await run(t=>activeTemplate(t,'SINGLETON'))).toBeNull();
  const up=await upload(admin,'SINGLETON',master('SINGLETON'));expect(up.version).toBe(1);expect(up.inspection.errors).toEqual([]);
  await expect(run(t=>approveTemplate(t,approver,{id:up.id}))).rejects.toMatchObject({code:'TEMPLATE_TEST_REQUIRED'});                       // not tested yet
  expect(await run(async t=>testTemplate(t,admin,store,up.id,await deps(false)))).toMatchObject({passed:false,problems:['TRISOMY','SCA']});   // read-back failure never validates
  expect((await db.query<{state:string}>('SELECT state FROM report_template_revision WHERE id=$1',[up.id])).rows[0].state).toBe('Uploaded');
  const ok=await run(async t=>testTemplate(t,admin,store,up.id,await deps(true)));expect(ok.passed).toBe(true);
  await expect(run(t=>approveTemplate(t,admin,{id:up.id}))).rejects.toMatchObject({code:'FORBIDDEN'});                                       // maker cannot approve
  await expect(run(t=>approveTemplate(t,approver,{id:up.id}))).rejects.toMatchObject({code:'TEMPLATE_PRODUCT_ACKNOWLEDGEMENT_REQUIRED'});     // HNZ0051 on the file, no approved product yet
  const approved=await run(t=>approveTemplate(t,approver,{id:up.id,acknowledgeProductDifference:true}));expect(approved.productDifference).toMatchObject({template:'HNZ0051'});
  await expect(run(t=>activateTemplate(t,lab,{id:up.id}))).rejects.toMatchObject({code:'FORBIDDEN'});
  await run(t=>activateTemplate(t,admin,{id:up.id}));
  const act=await run(t=>activeTemplate(t,'SINGLETON'));expect(act).toMatchObject({version:1,sha256:sha256(master('SINGLETON')),code:TEMPLATES.SINGLETON.code});
  expect(await run(t=>activeTemplate(t,'TWIN'))).toBeNull();                                                                                 // kinds are independent
  const actions=(await db.query<{action:string}>("SELECT action FROM audit_chain WHERE action LIKE 'REPORT_TEMPLATE_%' ORDER BY sequence")).rows.map(r=>r.action);
  expect(actions).toEqual(['REPORT_TEMPLATE_UPLOADED','REPORT_TEMPLATE_TEST_FAILED','REPORT_TEMPLATE_TESTED','REPORT_TEMPLATE_APPROVED','REPORT_TEMPLATE_ACTIVATED']);
 });
 it('a newer layout supersedes the old one without a rebuild; the old revision is archived, restorable and still the hash of what it issued',async()=>{
  const a=await upload(admin,'SINGLETON',master('SINGLETON'));
  const b=await upload(admin,'SINGLETON',variant('SINGLETON',addParagraph('Layout revision B')));
  expect(b.version).toBe(2);expect(b.inspection.errors).toEqual([]);
  for(const r of [a,b]){await run(async t=>testTemplate(t,admin,store,r.id,await deps()));await run(t=>approveTemplate(t,approver,{id:r.id,acknowledgeProductDifference:true}));}
  await run(t=>activateTemplate(t,admin,{id:a.id}));await run(t=>activateTemplate(t,admin2,{id:b.id}));
  expect((await run(t=>activeTemplate(t,'SINGLETON')))?.version).toBe(2);
  const states=(await db.query<{version:number;state:string}>("SELECT version,state FROM report_template_revision ORDER BY version")).rows;expect(states).toEqual([{version:1,state:'Archived'},{version:2,state:'Active'}]);
  await run(t=>activateTemplate(t,admin,{id:a.id}));                                                                                         // restore the previous approved layout
  expect((await run(t=>activeTemplate(t,'SINGLETON')))?.version).toBe(1);
  const view=await run(t=>templateOverview(t,admin)) as unknown as {kinds:{SINGLETON:{revisions:{version:number;state:string}[]}}};expect(view.kinds.SINGLETON.revisions.map(r=>r.state)).toEqual(['Archived','Active']);
 });
 it('inspection errors block testing/approval; duplicates, non-admins and rejected revisions are refused',async()=>{
  const bad=await upload(admin,'SINGLETON',variant('SINGLETON',retext('word/document.xml','patientName','patientNam')));
  expect(bad.inspection.errors.length).toBeGreaterThan(0);
  await expect(run(async t=>testTemplate(t,admin,store,bad.id,await deps()))).rejects.toMatchObject({code:'TEMPLATE_INSPECTION_ERRORS'});
  await expect(upload(admin,'SINGLETON',variant('SINGLETON',retext('word/document.xml','patientName','patientNam')))).rejects.toMatchObject({code:'TEMPLATE_ALREADY_REGISTERED'});
  await expect(upload(lab,'SINGLETON',master('SINGLETON'))).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(upload(approver,'SINGLETON',master('SINGLETON'))).rejects.toMatchObject({code:'FORBIDDEN'});                                  // approval authority is not upload authority
  await run(t=>rejectTemplate(t,admin,{id:bad.id,reason:'พิมพ์ผิดในแบบฟอร์ม'}));
  await expect(run(async t=>testTemplate(t,admin,store,bad.id,await deps()))).rejects.toMatchObject({code:'TEMPLATE_STATE_INVALID'});
  const good=await upload(admin,'TWIN',master('TWIN'));await run(async t=>testTemplate(t,admin,store,good.id,await deps()));await run(t=>approveTemplate(t,approver,{id:good.id,acknowledgeProductDifference:true}));await run(t=>activateTemplate(t,admin,{id:good.id}));
  await expect(upload(admin,'TWIN',master('TWIN'))).rejects.toMatchObject({code:'TEMPLATE_ALREADY_ACTIVE'});
 });
 it('the database itself enforces approval, independence, immutability and no deletion',async()=>{
  const r=await upload(admin,'SINGLETON',master('SINGLETON'));
  await expect(db.query("INSERT INTO report_template_active(kind,revision_id) VALUES('SINGLETON',$1)",[r.id])).rejects.toThrow(/REPORT_TEMPLATE_APPROVAL_REQUIRED/);
  await expect(db.query("UPDATE report_template_revision SET state='Validated' WHERE id=$1",[r.id])).rejects.toThrow(/REPORT_TEMPLATE_TEST_REQUIRED/);
  await expect(db.query("UPDATE report_template_revision SET state='Active' WHERE id=$1",[r.id])).rejects.toThrow(/REPORT_TEMPLATE_STATE_INVALID/);
  await expect(db.query("UPDATE report_template_revision SET file_sha256=repeat('0',64) WHERE id=$1",[r.id])).rejects.toThrow(/REPORT_TEMPLATE_IMMUTABLE/);
  await expect(db.query("UPDATE report_template_revision SET inspection='{\"errors\":[]}' WHERE id=$1",[r.id])).rejects.toThrow(/REPORT_TEMPLATE_IMMUTABLE/);
  await expect(db.query('DELETE FROM report_template_revision WHERE id=$1',[r.id])).rejects.toThrow(/REPORT_TEMPLATE_IMMUTABLE/);
  // Self-approval is impossible at the row level too.
  await run(async t=>testTemplate(t,admin,store,r.id,await deps()));
  await expect(db.query("UPDATE report_template_revision SET state='Approved',approved_by=created_by,approved_at=now() WHERE id=$1",[r.id])).rejects.toThrow();
 });
});
