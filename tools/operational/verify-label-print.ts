import * as fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {PDFDocument} from 'pdf-lib';
import {buildTubeLabelsHtml} from '../../packages/lab/labels';
const genomic=process.env.NIPT_LABEL_GENOMIC_WORKTREE;
if(!genomic)throw Error('GENOMIC_WORKTREE_REQUIRED');
const reference=await import(pathToFileURL(path.join(genomic,'lib/nipt/label-print.ts')).href);
const samples=['26B261012001','26B261012002D','26B261012003','26B261012004D'].map((lnHalos,i)=>({lnHalos,ln:i===3?'0'.repeat(24):'0000000'+i,patientName:null,printedSampleId:lnHalos+(i>1?'R':'-1')}));
const html=buildTubeLabelsHtml(samples);assert.equal(html,reference.buildTubeLabelsHtml(samples));assert.equal(buildTubeLabelsHtml(samples),html,'reprint keeps identical composition');
const output=await fs.mkdtemp(path.resolve('.local/label-50mm-'));
await fs.writeFile(path.join(output,'labels.html'),html);
const browser=await chromium.launch({headless:true});
try{const page=await browser.newPage({viewport:{width:190,height:76},deviceScaleFactor:3});await page.setContent(html);await page.emulateMedia({media:'print'});
 await page.pdf({path:path.join(output,'labels.pdf'),preferCSSPageSize:true,printBackground:true});
 await page.screenshot({path:path.join(output,'print-preview.png'),fullPage:true});
 const pdf=await PDFDocument.load(await fs.readFile(path.join(output,'labels.pdf')));assert.equal(pdf.getPageCount(),16);
 for(const p of pdf.getPages()){assert.ok(Math.abs(p.getWidth()-50*72/25.4)<1);assert.ok(Math.abs(p.getHeight()-20*72/25.4)<1);}
 const git=(cwd:string)=>execFileSync('git',['rev-parse','HEAD'],{cwd,encoding:'utf8'}).trim();
 await fs.writeFile(path.join(output,'evidence.json'),JSON.stringify({head:git(process.cwd()),genomicHead:git(genomic),timestamp:new Date().toISOString(),htmlParity:true,reprintParity:true,pages:16,stickerMm:[50,20],halfMm:[25,20],physicalPrinter:'NOT_RUN'},null,2));
 process.stdout.write(output+'\n');
}finally{await browser.close();}
