import {readdir,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import type {Queryable} from '../db/connection';
import type {FileStore} from '../storage';
import {authorize} from '../security/policy';
import {need,assertSession,audit,uuid,LabError,type Staff} from '../lab/core';
import {sha256} from '../workbook/archive';
import {openAuthorizedDirectory} from '../integrations/authorized-share';
import {readActiveSettings} from '../settings/service';
import {SETTINGS} from '../settings/catalog';
import {TEMPLATES,RULESET} from './interpretation';
import {fillReport,templateParts,TOKENS,DocxError,type ReportValues,type SignerSlot,type TemplateKind} from './docx';
import {renderDocxBatch,type RenderedPdf} from './native-word';
import {activeTemplate} from './template-active';
import {verifyRendered,watermark,type Prepared} from './reports';

/**
 * OWNER-LAB-056 — Admin-managed ReadyGen-style report templates.
 * ReadyGen keeps its Word templates in a configurable folder and fills `${fieldName}` placeholders from named sources.
 * NIPT-CBH keeps that model but adds the controls a clinical report needs:
 *   inspect (unknown / ambiguous / missing placeholders, macros, links, product text)  →  watermarked preview rendered by Word and
 *   read back with the SAME verification as a real report  →  independent approval  →  Active for that kind.
 * The placeholder vocabulary and the interpretation ruleset stay code- and approval-governed (no clinical rule is editable here):
 * a layout may change freely as long as it stays mapping-compatible. Revisions are immutable; issued finals keep their hash.
 */
const MAX_BYTES=5*1024*1024;
export type TemplateInspection={errors:{code:string;detail?:unknown}[];warnings:{code:string;detail?:unknown}[];
 found:string[];unknown:{token:string;suggestion:string|null}[];missing:string[];ambiguous:string[];product:string|null;code:string|null};
const ALLOWED_EXTRA=['createdDate_cbh'];
const allowed=(kind:TemplateKind)=>new Set<string>([...TOKENS[kind],...ALLOWED_EXTRA]);
const lev=(a:string,b:string)=>{const d=Array.from({length:a.length+1},(_,i)=>[i,...Array(b.length).fill(0)]);for(let j=1;j<=b.length;j++)d[0][j]=j;
 for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));return d[a.length][b.length];};
const suggest=(token:string,kind:TemplateKind)=>[...allowed(kind)].map(t=>({t,d:t.toLowerCase()===token.toLowerCase()?0:lev(token.toLowerCase(),t.toLowerCase())})).filter(x=>x.d<=2).sort((a,b)=>a.d-b.d)[0]?.t??null;
// Syntaxes that look like a placeholder but are not ReadyGen's `${name}`: left in the file they would print literally.
const AMBIGUOUS:RegExp[]=[/\$\s+\{/,/\$\{[^}]*$/,/\$\{\s*\}/,/\$\{[^}]*[^A-Za-z0-9_}][^}]*\}/,/(?<!\$)\{[A-Za-z0-9_]+\}/,/\$\[[^\]]+\]/,/%[A-Za-z_]+%/,/<<[^>]+>>/,/#\{[^}]+\}/];

/** Pure inspection of a DOCX against the placeholder vocabulary of its kind (no clinical content is read or changed). */
export function inspectTemplate(kind:TemplateKind,bytes:Buffer,fileName=''):TemplateInspection{
 const out:TemplateInspection={errors:[],warnings:[],found:[],unknown:[],missing:[],ambiguous:[],product:null,code:null};
 const err=(code:string,detail?:unknown)=>out.errors.push({code,detail});
 if(bytes.length>MAX_BYTES){err('TEMPLATE_TOO_LARGE');return out;}
 if(bytes.length<4||bytes.readUInt32LE(0)!==0x04034b50){err('TEMPLATE_NOT_DOCX');return out;}
 let parts:ReturnType<typeof templateParts>;try{parts=templateParts(bytes);}catch{err('TEMPLATE_NOT_DOCX');return out;}
 if(!parts.names.includes('word/document.xml')||!parts.contentTypes.includes('wordprocessingml.document.main+xml')){err('TEMPLATE_NOT_DOCX');return out;}
 if(parts.names.some(n=>/vbaProject|\.bin$|activeX|embeddings\//i.test(n))||/macroEnabled/.test(parts.contentTypes))err('TEMPLATE_HAS_MACROS_OR_EMBEDDED_CODE');
 if(/TargetMode="External"/.test(parts.rels)&&/Type="[^"]*\/(?:oleObject|attachedTemplate|image|subDocument|frame)"[^>]*TargetMode="External"|TargetMode="External"[^>]*Type="[^"]*\/(?:oleObject|attachedTemplate|image|subDocument|frame)"/.test(parts.rels))err('TEMPLATE_HAS_EXTERNAL_LINKS');
 const found=new Set<string>(),amb=new Set<string>(),text:string[]=[];
 for(const part of parts.parts)for(const p of part.paragraphs){text.push(p);
  for(const m of p.matchAll(/\$\{([A-Za-z0-9_]+)\}/g))found.add(m[1]);
  for(const re of AMBIGUOUS)if(re.test(p))amb.add(p.trim().slice(0,80));}
 const known=allowed(kind);out.found=[...found].sort();
 out.unknown=out.found.filter(t=>!known.has(t)).map(token=>({token,suggestion:suggest(token,kind)}));
 out.missing=TOKENS[kind].filter(t=>!found.has(t));out.ambiguous=[...amb];
 if(out.unknown.length)err('TEMPLATE_UNKNOWN_PLACEHOLDER',out.unknown);
 if(out.ambiguous.length)err('TEMPLATE_AMBIGUOUS_PLACEHOLDER_SYNTAX',out.ambiguous);
 if(out.missing.length)err('TEMPLATE_PLACEHOLDER_MISSING',out.missing);
 const joined=text.join('\n');
 // The Owner's masters print the form code as "Fm-WI-T-BM17-07" (case and hyphen vary) and state the product only in the file name
 // ("… HNZ0051-Singleton"); both spellings normalise to one controlled-document code / product.
 const codeMatch=/\bFM-WI-T-BM-?(\d{1,3})-(\d{1,3})\b/i.exec(joined);out.code=codeMatch?`FM-WI-T-BM-${codeMatch[1]}-${codeMatch[2]}`:null;
 out.product=/\bHNZ[0-9]{4}\b/.exec(joined)?.[0]??/\bHNZ[0-9]{4}\b/.exec(fileName)?.[0]??null;
 // The controlled-document code identifies the form (FM-WI-T-BM-17-07 Singleton / -08 Twin) and is recorded on every issued report, so a template must keep it.
 if(!out.code)err('TEMPLATE_DOCUMENT_CODE_MISSING',{expected:TEMPLATES[kind].code});
 else if(out.code!==TEMPLATES[kind].code)err('TEMPLATE_DOCUMENT_CODE_MISMATCH',{found:out.code,expected:TEMPLATES[kind].code});
 if(!out.product)out.warnings.push({code:'TEMPLATE_PRODUCT_NOT_STATED'});
 // Structural dry run: the real fill routine (signature slots, "Reported/Approved by", license line, QC line, no leftovers).
 if(!out.errors.length){try{fillReport(bytes,kind,syntheticValues(),{reported:syntheticSigner('A'),approved:syntheticSigner('B')},{sha256:sha256(bytes),code:out.code??'UNSPECIFIED'});}
  catch(e){if(e instanceof DocxError)err('TEMPLATE_STRUCTURE_INCOMPATIBLE',{code:e.message,details:e.details});else throw e;}}
 return out;
}
const syntheticSigner=(tag:string):SignerSlot=>({name:`PREVIEW SIGNER ${tag}`,license:'00000',date:'01-Jan-2026',signature:null});
/** Clearly synthetic values that read back through the real report parser (no patient data, never stored as a report). */
export function syntheticValues():ReportValues{
 return {patientName:'ทดสอบ ตัวอย่าง (PREVIEW)',ga:'17W 6D',sampleID:'PREVIEW0000001',hn:'0000000/00',collectDate_cbh:'01-Jan-2026',patientIDCard:'-',dob_cbh:'01-Jan-1990',receivedDate_cbh:'01-Jan-2026',
  referringPhysician:'-',hospitalName:'PREVIEW',remarks:'PREVIEW - synthetic values',sampleType:'Plasma',qc:'PASS',// Every printed result differs from its neighbours (T18 High Risk, XXX Detected, three different probabilities), so a template that
  // places a placeholder in the wrong cell reads back wrong and is refused instead of passing by coincidence.
  trisomy21_ra:'Low Risk',trisomy18_ra:'High Risk',trisomy13_ra:'Low Risk',risk21:'1/10001',risk18:'1/12',risk13:'1/10003',gender:'Female',gender_cbh:'Not Detected',
  XO_NEW:'Not Detected',XXX_NEW:'Detected',XXY_NEW:'Not Detected',XYY_NEW:'Not Detected',fetalFaction_2:'10.00'};
}

const kindSchema=z.enum(['SINGLETON','TWIN']);
const reasonSchema=z.string().trim().min(1).max(250);
type Row={id:string;kind:TemplateKind;version:number;file_sha256:string;original_name:string;byte_size:number;template_code:string|null;product_in_template:string|null;tokens:unknown;inspection:TemplateInspection;
 source:string;source_path:string|null;reason:string;created_by:string;created_at:Date;state:string;test_passed:boolean;tested_at:Date|null;preview_sha256:string|null;product_acknowledged_by:string|null;approved_by:string|null;approved_at:Date|null;activated_at:Date|null};
const cols='id,kind,version,file_sha256,original_name,byte_size,template_code,product_in_template,tokens,inspection,source,source_path,reason,created_by,created_at,state,test_passed,tested_at,preview_sha256,product_acknowledged_by,approved_by,approved_at,activated_at';
const manage=(user:Staff,op:'read'|'write'='write')=>{if(!authorize(user,'report.template.manage',{},op))throw new LabError('FORBIDDEN',403);};
const lock=(db:Queryable,kind:string)=>db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['report_template:'+kind]);

export {activeTemplate};
/** Folder import (ReadyGen's template folder): read-only listing of .docx candidates through the same authorized-directory checks as HIS folders. */
export async function listTemplateFolder(user:Staff,folder:string){
 manage(user,'read');const dir=await openAuthorizedDirectory(z.string().trim().min(1).max(500).parse(folder),'RESULTS',null);
 const files=[];for(const n of await readdir(dir.base)){if(!/\.docx$/i.test(n)||n.startsWith('~$'))continue;const st=await stat(path.join(dir.base,n));if(st.isFile()&&st.size<=MAX_BYTES)files.push({name:n,size:st.size,modifiedAt:st.mtime.toISOString()});}
 return {folder:dir.base,files:files.sort((a,b)=>a.name.localeCompare(b.name))};
}
export async function readTemplateFolderFile(user:Staff,folder:string,name:string){
 manage(user,'read');if(!/^[^\\/:*?"<>|]+\.docx$/i.test(name))throw new LabError('TEMPLATE_NAME_INVALID',422);
 const dir=await openAuthorizedDirectory(z.string().trim().min(1).max(500).parse(folder),'RESULTS',null);return {bytes:await readFile(await dir.file(name)),base:dir.base};
}

export async function uploadTemplate(db:Queryable,user:Staff,store:FileStore,raw:unknown){
 await assertSession(db,user);manage(user);
 const d=z.strictObject({kind:kindSchema,name:z.string().trim().min(1).max(255),bytes:z.instanceof(Buffer),reason:reasonSchema,source:z.enum(['UPLOAD','FOLDER']).default('UPLOAD'),sourcePath:z.string().max(500).nullable().default(null)}).parse(raw);
 const kind=d.kind;await lock(db,kind);
 const inspection=inspectTemplate(kind,d.bytes,d.name),hash=sha256(d.bytes);
 const active=await activeTemplate(db,kind);
 if(active?.sha256===hash)throw new LabError('TEMPLATE_ALREADY_ACTIVE',409);
 if((await db.query('SELECT 1 FROM report_template_revision WHERE kind=$1 AND file_sha256=$2 AND state NOT IN(\'Rejected\')',[kind,hash])).rows[0])throw new LabError('TEMPLATE_ALREADY_REGISTERED',409);
 const storedHash=await store.put(d.bytes);if(storedHash!==hash)throw new LabError('TEMPLATE_STORE_MISMATCH',500);
 const version=(await db.query<{v:number}>('SELECT COALESCE(max(version),0)+1 v FROM report_template_revision WHERE kind=$1',[kind])).rows[0].v;
 const row=(await db.query<{id:string}>(`INSERT INTO report_template_revision(kind,version,file_sha256,original_name,byte_size,template_code,product_in_template,tokens,inspection,source,source_path,reason,created_by)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,[kind,version,hash,d.name,d.bytes.length,inspection.code,inspection.product,JSON.stringify(inspection.found),JSON.stringify(inspection),d.source,d.sourcePath,d.reason,user.id])).rows[0];
 await audit(db,user,'REPORT_TEMPLATE_UPLOADED','REPORT_TEMPLATE',row.id,{version,outcome:inspection.errors.length?'INSPECTION_ERRORS':'INSPECTED',count:inspection.errors.length});
 return {id:row.id,version,inspection};
}

export type TemplateTestDeps={render?:(items:{id:string;docx:Buffer}[])=>Promise<RenderedPdf[]>;verify?:typeof verifyRendered};
/** Fills the template with synthetic values, renders it (Word), and requires the PDF to read back exactly as a real report would. */
export async function testTemplate(db:Queryable,user:Staff,store:FileStore,id:string,deps:TemplateTestDeps={}){
 await assertSession(db,user);manage(user);
 const r=(await db.query<Row>(`SELECT ${cols} FROM report_template_revision WHERE id=$1 FOR UPDATE`,[uuid.parse(id)])).rows[0];
 if(!r)throw new LabError('NOT_FOUND',404);if(r.state!=='Uploaded')throw new LabError('TEMPLATE_STATE_INVALID',409);
 if(r.inspection.errors.length)throw new LabError('TEMPLATE_INSPECTION_ERRORS',409,{errors:r.inspection.errors.map(e=>e.code)});
 const bytes=await store.get(r.file_sha256);if(sha256(bytes)!==r.file_sha256)throw new LabError('TEMPLATE_STORE_CORRUPT',500);
 const values=syntheticValues(),signers={reported:syntheticSigner('A'),approved:syntheticSigner('B')};
 const docx=fillReport(bytes,r.kind,values,signers,{sha256:r.file_sha256,code:r.template_code??'UNSPECIFIED'});
 const [pdf]=await(deps.render??renderDocxBatch)([{id:'template-preview',docx:docx.bytes}]);
 const prepared={template:r.kind,noCall:false,values,sources:{gaDays:125}} as unknown as Prepared;
 const check=await(deps.verify??verifyRendered)(pdf.bytes,prepared,signers);
 if(!check.ok){await audit(db,user,'REPORT_TEMPLATE_TEST_FAILED','REPORT_TEMPLATE',r.id,{version:r.version,outcome:'FAILED',count:check.problems.length,reasonCode:check.problems.slice(0,6).join('.').slice(0,79)});
  return {passed:false,problems:check.problems,pages:pdf.pages};}
 const preview=await store.put(await watermark(pdf.bytes));
 await db.query("UPDATE report_template_revision SET state='Validated',test_passed=true,tested_at=now(),preview_sha256=$2 WHERE id=$1",[r.id,preview]);
 await audit(db,user,'REPORT_TEMPLATE_TESTED','REPORT_TEMPLATE',r.id,{version:r.version,outcome:'PASSED'});
 return {passed:true,problems:[] as string[],pages:pdf.pages,previewSha256:preview};
}
export async function previewPdf(db:Queryable,user:Staff,store:FileStore,id:string){
 await assertSession(db,user);if(!authorize(user,'report.template.manage',{},'read')&&!authorize(user,'settings.approve',{},'approve'))throw new LabError('FORBIDDEN',403);
 const r=(await db.query<{preview_sha256:string|null;kind:string;version:number}>('SELECT preview_sha256,kind,version FROM report_template_revision WHERE id=$1',[uuid.parse(id)])).rows[0];
 if(!r?.preview_sha256)throw new LabError('NOT_FOUND',404);return {bytes:await store.get(r.preview_sha256),name:`template-preview-${r.kind}-v${r.version}.pdf`};
}
/** Product text printed on the template can differ from the product approved for reports (HNZ0011 vs HNZ0051): disclosed, never silently accepted. */
async function approvedProduct(db:Queryable,kind:TemplateKind){
 const v=SETTINGS.report_interpretation.schema.parse((await readActiveSettings(db)).report_interpretation??SETTINGS.report_interpretation.default);
 return (kind==='SINGLETON'?v.singletonApprovedProduct:v.twinApprovedProduct)||null;
}
export async function approveTemplate(db:Queryable,user:Staff,raw:unknown){
 await assertSession(db,user);
 const d=z.strictObject({id:uuid,acknowledgeProductDifference:z.boolean().default(false)}).parse(raw);
 const r=(await db.query<Row>(`SELECT ${cols} FROM report_template_revision WHERE id=$1 FOR UPDATE`,[d.id])).rows[0];
 if(!r)throw new LabError('NOT_FOUND',404);
 need(user,'settings.approve','approve',{actorId:r.created_by});
 if(r.state!=='Validated'||!r.test_passed)throw new LabError('TEMPLATE_TEST_REQUIRED',409);
 if(r.created_by===user.id)throw new LabError('SECOND_PERSON_REQUIRED',403);
 const approved=await approvedProduct(db,r.kind),differs=!!r.product_in_template&&r.product_in_template!==approved;
 if(differs&&!d.acknowledgeProductDifference)throw new LabError('TEMPLATE_PRODUCT_ACKNOWLEDGEMENT_REQUIRED',409,{template:r.product_in_template,approved});
 await db.query("UPDATE report_template_revision SET state='Approved',approved_by=$2,approved_at=now(),product_acknowledged_by=$3 WHERE id=$1",[r.id,user.id,differs?user.id:null]);
 await audit(db,user,'REPORT_TEMPLATE_APPROVED','REPORT_TEMPLATE',r.id,{version:r.version,outcome:'APPROVED',...(differs?{reasonCode:'PRODUCT_DIFFERENCE_ACKNOWLEDGED'}:{})});
 return {id:r.id,version:r.version,productDifference:differs?{template:r.product_in_template,approved}:null};
}
export async function rejectTemplate(db:Queryable,user:Staff,raw:unknown){
 await assertSession(db,user);
 const d=z.strictObject({id:uuid,reason:reasonSchema}).parse(raw);
 const r=(await db.query<Row>(`SELECT ${cols} FROM report_template_revision WHERE id=$1 FOR UPDATE`,[d.id])).rows[0];if(!r)throw new LabError('NOT_FOUND',404);
 if(!authorize(user,'report.template.manage',{},'write')&&!authorize(user,'settings.approve',{actorId:r.created_by},'approve'))throw new LabError('FORBIDDEN',403);
 if(!['Uploaded','Validated','Approved'].includes(r.state))throw new LabError('TEMPLATE_STATE_INVALID',409);
 await db.query("UPDATE report_template_revision SET state='Rejected' WHERE id=$1",[r.id]);
 await audit(db,user,'REPORT_TEMPLATE_REJECTED','REPORT_TEMPLATE',r.id,{version:r.version,outcome:'REJECTED'});return {id:r.id};
}
/** Makes an approved revision the template used for new reports (also restores an archived approved one). Issued finals keep their own hash. */
export async function activateTemplate(db:Queryable,user:Staff,raw:unknown){
 await assertSession(db,user);manage(user);
 const d=z.strictObject({id:uuid}).parse(raw);
 const r0=(await db.query<{kind:TemplateKind}>('SELECT kind FROM report_template_revision WHERE id=$1',[d.id])).rows[0];if(!r0)throw new LabError('NOT_FOUND',404);
 await lock(db,r0.kind);
 const r=(await db.query<Row>(`SELECT ${cols} FROM report_template_revision WHERE id=$1 FOR UPDATE`,[d.id])).rows[0];
 if(!['Approved','Archived'].includes(r.state)||!r.approved_by)throw new LabError('TEMPLATE_APPROVAL_REQUIRED',409);
 const prev=(await db.query<{revision_id:string}>('SELECT revision_id FROM report_template_active WHERE kind=$1',[r.kind])).rows[0];
 if(prev&&prev.revision_id!==r.id)await db.query("UPDATE report_template_revision SET state='Archived' WHERE id=$1 AND state='Active'",[prev.revision_id]);
 await db.query('INSERT INTO report_template_active(kind,revision_id) VALUES($1,$2) ON CONFLICT(kind) DO UPDATE SET revision_id=excluded.revision_id,changed_at=now()',[r.kind,r.id]);
 await db.query("UPDATE report_template_revision SET state='Active',activated_at=now() WHERE id=$1",[r.id]);
 await audit(db,user,'REPORT_TEMPLATE_ACTIVATED','REPORT_TEMPLATE',r.id,{version:r.version,outcome:'ACTIVE'});
 return {id:r.id,kind:r.kind,version:r.version};
}
const MASTER_ENV={SINGLETON:'NIPT_REPORT_TEMPLATE_SINGLETON',TWIN:'NIPT_REPORT_TEMPLATE_TWIN'} as const;
/** Overview for Settings: Owner's locked master (reference), the Active revision and the revision history. */
export async function templateOverview(db:Queryable,user:Staff){
 await assertSession(db,user);if(!authorize(user,'report.template.manage',{},'read')&&!authorize(user,'settings.approve',{},'approve'))throw new LabError('FORBIDDEN',403);
 const rows=(await db.query<Row>(`SELECT ${cols} FROM report_template_revision ORDER BY kind,version DESC LIMIT 60`)).rows;
 const out:Record<string,unknown>={};
 for(const kind of ['SINGLETON','TWIN'] as const){
  const installed=!!process.env[MASTER_ENV[kind]];
  out[kind]={locked:{code:TEMPLATES[kind].code,product:TEMPLATES[kind].product,sha256:TEMPLATES[kind].sha256,installed},approvedProduct:await approvedProduct(db,kind),
   active:rows.find(r=>r.kind===kind&&r.state==='Active')?.id??null,
   revisions:rows.filter(r=>r.kind===kind).map(r=>({id:r.id,version:r.version,state:r.state,name:r.original_name,size:r.byte_size,sha256:r.file_sha256,code:r.template_code,product:r.product_in_template,source:r.source,
    createdAt:r.created_at,reason:r.reason,createdBy:r.created_by,approvedBy:r.approved_by,tested:r.test_passed,hasPreview:!!r.preview_sha256,inspection:r.inspection,productAcknowledged:!!r.product_acknowledged_by}))};
 }
 return {kinds:out,vocabulary:{SINGLETON:TOKENS.SINGLETON,TWIN:TOKENS.TWIN,extra:ALLOWED_EXTRA},ruleset:{id:RULESET.id,version:RULESET.version}};
}
