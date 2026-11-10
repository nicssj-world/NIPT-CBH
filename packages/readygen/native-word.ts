import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {promisify} from 'node:util';
import {mkdir,mkdtemp,readFile,rename,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {sha256} from '../workbook/archive';
import {stopOwnOfficeInstance} from '../workbook/office-instance';
const run=promisify(execFile);

// Native Microsoft Word rendering of filled DOCX masters. Inputs live only in a private temporary directory that is removed
// afterwards; the PDF bytes are returned to the caller, which stores them content-addressed. Nothing is printed or opened.
export type RenderedPdf={id:string;bytes:Buffer;sha256:string;pages:number;renderer:'Microsoft Word'};
/** The installed web process runs as a service account and cannot start Word. It hands the files to the owner's-session bridge (the same one that
 *  renders the Task List workbooks in Excel) through the spool folder and waits for the PDFs; no network listener is involved. */
async function renderThroughHostSpool(items:{id:string;docx:Buffer}[]):Promise<RenderedPdf[]>{
 const spool=process.env.NIPT_NATIVE_EXCEL_SPOOL;
 if(!spool||!path.isAbsolute(spool)||items.some(i=>i.docx.length<4||i.docx.length>20*1024*1024))throw new Error('REPORT_NATIVE_WORD_SPOOL_INVALID');
 const inbox=path.join(spool,'inbox'),outbox=path.join(spool,'outbox'),id=randomUUID(),output=path.join(outbox,id);
 const request=path.join(inbox,id+'.json'),temporary=path.join(inbox,id+'.json.tmp'),inputs=items.map((_,n)=>path.join(inbox,`${id}-${n}.docx`));
 await mkdir(inbox,{recursive:true});await mkdir(outbox,{recursive:true});
 try{
  for(const [n,file] of inputs.entries())await writeFile(file,items[n].docx,{flag:'wx'});
  await writeFile(temporary,JSON.stringify({version:1,id,kind:'word',count:items.length}),{flag:'wx'});
  await rename(temporary,request);
  const until=Date.now()+60000+items.length*20000+30000;
  while(Date.now()<until){
   let raw:string;
   try{raw=await readFile(path.join(output,'status.json'),'utf8');}
   catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT'){await new Promise(r=>setTimeout(r,250));continue;}throw e;}
   const status=JSON.parse(raw.replace(/^﻿/,'')) as {ok?:boolean;code?:string};
   if(status.ok!==true)throw new Error(typeof status.code==='string'&&/^[A-Z0-9_]{2,80}$/.test(status.code)?status.code:'REPORT_NATIVE_WORD_FAILED');
   const result=JSON.parse((await readFile(path.join(output,'manifest.json.result.json'),'utf8')).replace(/^﻿/,'')) as {id:string;pages:number}[]|{id:string;pages:number};
   const pages=new Map((Array.isArray(result)?result:[result]).map(r=>[r.id,Number(r.pages)]));
   return Promise.all(items.map(async(it,n)=>{const bytes=await readFile(path.join(output,`${n}.pdf`));if(bytes.subarray(0,5).toString()!=='%PDF-')throw new Error('REPORT_NATIVE_WORD_OUTPUT_INVALID');
    return {id:it.id,bytes,sha256:sha256(bytes),pages:pages.get(String(n))??0,renderer:'Microsoft Word' as const};}));
  }
  throw new Error('REPORT_NATIVE_WORD_TIMEOUT');
 }finally{
  await rm(temporary,{force:true}).catch(()=>{});await rm(request,{force:true}).catch(()=>{});
  for(const file of inputs)await rm(file,{force:true}).catch(()=>{});
  await rm(output,{recursive:true,force:true}).catch(()=>{});
 }
}
export async function renderDocxBatch(items:{id:string;docx:Buffer}[]):Promise<RenderedPdf[]>{
 if(process.platform!=='win32')throw new Error('REPORT_NATIVE_WORD_WINDOWS_REQUIRED');
 if(!items.length||items.length>200||new Set(items.map(i=>i.id)).size!==items.length)throw new Error('REPORT_BATCH_SIZE_INVALID');
 if(process.env.NIPT_NATIVE_EXCEL_SPOOL)return renderThroughHostSpool(items);
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
   // The real cause (spawn failure, timeout, script stderr) goes to the worker log; the screen gets a stable code.
   const err=e as NodeJS.ErrnoException&{killed?:boolean;stderr?:string};
   process.stderr.write(`REPORT_NATIVE_WORD_FAILED ${err.code??''} ${err.killed?'timeout ':''}${String(err.stderr||err.message).slice(0,500)}\n`);
   throw new Error(err.killed?'REPORT_NATIVE_WORD_TIMEOUT':'REPORT_NATIVE_WORD_FAILED');
  }
  const result=JSON.parse((await readFile(file+'.result.json','utf8')).replace(/^﻿/,'')) as {id:string;pages:number}[]|{id:string;pages:number};
  const pages=new Map((Array.isArray(result)?result:[result]).map(r=>[r.id,Number(r.pages)]));
  return Promise.all(manifest.map(async m=>{const bytes=await readFile(m.output);if(bytes.subarray(0,5).toString()!=='%PDF-')throw new Error('REPORT_NATIVE_WORD_OUTPUT_INVALID');
   return {id:m.id,bytes,sha256:sha256(bytes),pages:pages.get(m.id)??0,renderer:'Microsoft Word' as const};}));
 }finally{await rm(temp,{recursive:true,force:true});}
}
