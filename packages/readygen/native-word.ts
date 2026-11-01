import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {sha256} from '../workbook/archive';
import {stopOwnOfficeInstance} from '../workbook/office-instance';
const run=promisify(execFile);

// Native Microsoft Word rendering of filled DOCX masters. Inputs live only in a private temporary directory that is removed
// afterwards; the PDF bytes are returned to the caller, which stores them content-addressed. Nothing is printed or opened.
export type RenderedPdf={id:string;bytes:Buffer;sha256:string;pages:number;renderer:'Microsoft Word'};
export async function renderDocxBatch(items:{id:string;docx:Buffer}[]):Promise<RenderedPdf[]>{
 if(process.platform!=='win32')throw new Error('REPORT_NATIVE_WORD_WINDOWS_REQUIRED');
 if(!items.length||items.length>200||new Set(items.map(i=>i.id)).size!==items.length)throw new Error('REPORT_BATCH_SIZE_INVALID');
 const temp=await mkdtemp(path.join(tmpdir(),'nipt-report-'));
 try{
  const manifest=items.map(i=>({id:i.id,input:path.join(temp,randomUUID()+'.docx'),output:path.join(temp,randomUUID()+'.pdf')}));
  for(const [n,m] of manifest.entries())await writeFile(m.input,items[n].docx,{flag:'wx'});
  const file=path.join(temp,'manifest.json');await writeFile(file,JSON.stringify(manifest),{flag:'wx'});
  const pidFile=path.join(temp,'office.pid');
  try{
   await run(process.env.NIPT_NATIVE_POWERSHELL??'pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',path.join(process.cwd(),'packages/readygen/word-export.ps1'),'-Manifest',file],
    {windowsHide:true,maxBuffer:1024*1024,timeout:60000+items.length*20000,env:{...process.env,NIPT_OFFICE_PID_FILE:pidFile}});
  }catch(e){
   // a script stopped by its timeout cannot quit Word itself: never leave that hidden instance for the next export to attach to
   await stopOwnOfficeInstance(pidFile,'WINWORD.EXE');
   throw e;
  }
  const result=JSON.parse((await readFile(file+'.result.json','utf8')).replace(/^﻿/,'')) as {id:string;pages:number}[]|{id:string;pages:number};
  const pages=new Map((Array.isArray(result)?result:[result]).map(r=>[r.id,Number(r.pages)]));
  return Promise.all(manifest.map(async m=>{const bytes=await readFile(m.output);if(bytes.subarray(0,5).toString()!=='%PDF-')throw new Error('REPORT_NATIVE_WORD_OUTPUT_INVALID');
   return {id:m.id,bytes,sha256:sha256(bytes),pages:pages.get(m.id)??0,renderer:'Microsoft Word' as const};}));
 }finally{await rm(temp,{recursive:true,force:true});}
}
