/** Microsoft Office readiness proof for the signed-in Windows session that runs the NIPT services (installed or source tree).
 *    tsx tools/win-installer/office-check.ts [--out <result.json>] [--report-master <singleton.docx>] [--excel-workbook <master.xlsx>]
 *  Word : renders a synthetic one-page document with a patient-style name, a professional licence number and TWO signature
 *         images at the Reported-by / Approved-by positions through the production renderer (packages/readygen/native-word.ts).
 *         With --report-master the real Owner SINGLETON master is filled by the production filler (fillReport) with synthetic signers.
 *  Excel: exports the approved master workbook through the production Task List path (direct, or the user-session bridge when
 *         NIPT_NATIVE_EXCEL_SPOOL is set).
 *  It only writes to a private temporary directory; no patient data and no database are touched. Exit code 0 only when every step passed. */
import {writeFile,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {renderDocxBatch} from '../../packages/readygen/native-word';
import {fillReport,type ReportValues,type SignerSlot} from '../../packages/readygen/docx';
import {exportTaskPdfs} from '../../packages/workbook/native-pdf';
import {writeArchive} from '../../packages/workbook/archive';
import {signaturePng} from '../task3-uat/signature';

const arg=(n:string)=>{const i=process.argv.indexOf('--'+n);return i<0?undefined:process.argv[i+1];};
const steps:{id:string;ok:boolean;detail?:unknown}[]=[];
const step=async(id:string,fn:()=>Promise<unknown>)=>{try{steps.push({id,ok:true,detail:await fn()});}catch(e){steps.push({id,ok:false,detail:(e as Error).message});}};
const imageCount=(pdf:Buffer)=>(pdf.toString('latin1').match(/\/Subtype\s*\/Image/g)??[]).length;

const EMU=(px:number)=>px*9525;
const pic=(rid:string,id:number,w:number,h:number)=>`<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${EMU(w)}" cy="${EMU(h)}"/><wp:docPr id="${id}" name="Signature ${id}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="sig${id}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${EMU(w)}" cy="${EMU(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
const para=(text:string)=>`<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
/** Minimal valid DOCX: name + licence lines and two inline signature pictures (no template, no patient data). */
function syntheticDocx(){
 const document=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${para('NIPT office readiness check - synthetic content')}${para('Reported by: Synthetic Reporter  Licence No. 99001')}<w:p>${pic('rId10',1,160,54)}</w:p>${para('Approved by: Synthetic Approver  Licence No. 99002')}<w:p>${pic('rId11',2,160,54)}</w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
 return writeArchive(new Map<string,Buffer>([
  ['[Content_Types].xml',Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')],
  ['_rels/.rels',Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')],
  ['word/_rels/document.xml.rels',Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/sig1.png"/><Relationship Id="rId11" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/sig2.png"/></Relationships>')],
  ['word/document.xml',Buffer.from(document)],['word/media/sig1.png',signaturePng(1)],['word/media/sig2.png',signaturePng(2)]]));
}

const session=process.env.SESSIONNAME??'';
await step('session',async()=>({user:process.env.USERNAME,computer:process.env.COMPUTERNAME,sessionName:session,mode:process.env.NIPT_NATIVE_EXCEL_SPOOL?'excel-bridge':'excel-direct'}));
await step('word_synthetic_signers',async()=>{
 const [pdf]=await renderDocxBatch([{id:'office-check',docx:syntheticDocx()}]);
 if(pdf.pages<1)throw Error('NO_PAGES');
 const images=imageCount(pdf.bytes);if(images<2)throw Error('SIGNATURE_IMAGES_MISSING:'+images);
 return {renderer:pdf.renderer,pages:pdf.pages,bytes:pdf.bytes.length,signatureImages:images,sha256:pdf.sha256};
});
const reportMaster=arg('report-master');
if(reportMaster)await step('word_report_master_fill',async()=>{
 const slot=(name:string,license:string,date:string,seed:number):SignerSlot=>({name,license,date,signature:{bytes:signaturePng(seed),media:'image/png'}});
 const values:ReportValues={patientName:'Synthetic Patient Name',ga:'17W 6D',sampleID:'99B990101001-1',hn:'99000001',collectDate_cbh:'20-Oct-2026',patientIDCard:'0000000000000',dob_cbh:'01-Jan-1990',receivedDate_cbh:'20-Oct-2026',referringPhysician:'SYNTHETIC REFERRING DOCTOR',hospitalName:'Synthetic hospital',remarks:'',sampleType:'Peripheral Blood',qc:'PASS',trisomy21_ra:'Low Risk',trisomy18_ra:'Low Risk',trisomy13_ra:'Low Risk',risk21:'1/2143998259',risk18:'1/2143998259',risk13:'1/39594481',gender:'Female',gender_cbh:'Not Detected',XO_NEW:'Not Detected',XXX_NEW:'Not Detected',XXY_NEW:'Not Detected',XYY_NEW:'Not Detected',fetalFaction_2:'14.70'};
 const filled=fillReport(await readFile(reportMaster),'SINGLETON',values,{reported:slot('Synthetic Reporter','99001','24-Oct-2026',1),approved:slot('Synthetic Approver','99002','25-Oct-2026',2)});
 const [pdf]=await renderDocxBatch([{id:'master',docx:filled.bytes}]);
 const images=imageCount(pdf.bytes);if(images<2)throw Error('SIGNATURE_IMAGES_MISSING:'+images);
 return {pages:pdf.pages,bytes:pdf.bytes.length,signatureImages:images,sha256:pdf.sha256};
});
const workbook=arg('excel-workbook');
if(workbook)await step('excel_master_task_pdf',async()=>{
 if(!existsSync(workbook))throw Error('EXCEL_WORKBOOK_NOT_FOUND');
 const out=await exportTaskPdfs(await readFile(workbook));
 const bad=out.filter(o=>o.bytes.subarray(0,5).toString()!=='%PDF-');if(bad.length)throw Error('EXCEL_OUTPUT_INVALID:'+JSON.stringify(bad.map(o=>({sheet:o.sheet,head:o.bytes.subarray(0,5).toString()}))));
 return out.map(o=>({sheet:o.sheet,pages:o.pageCount,bytes:o.bytes.length,formulas:o.formulaCount,emptyTemplateFormulaErrors:o.formulaErrors.length,sha256:o.sha256}));
});
const ok=steps.every(s=>s.ok);
const result={tool:'NIPT-CBH office-check',at:new Date().toISOString(),ok,steps};
const out=arg('out');if(out)await writeFile(path.resolve(out),JSON.stringify(result,null,1));
process.stdout.write(JSON.stringify(result)+'\n');
process.exitCode=ok?0:1;
