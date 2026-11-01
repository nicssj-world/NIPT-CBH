import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {SHEETS} from './master';
import {sha256} from './archive';
import {restoreNativeA4Coordinates} from './pdf-media';
import {stopOwnOfficeInstance} from './office-instance';
const run=promisify(execFile);
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
type NativeEntry={index:number;zoom:number|false;formulaCount:number;formulaErrors:{cell:string;error:string}[];poolingCalculation:null|{D52:number|null;F52:number;D55:number;F52Formula:string;D55Formula:string}};
const PAGE_COUNTS=[2,2,2,1,1,1] as const;

async function verifyNativeOutput(output:string,selectedSheets:readonly string[]) {
  const calculation=JSON.parse(await readFile(path.join(output,'native-manifest.json'),'utf8')) as NativeEntry[];
  if(calculation.length!==6||calculation.reduce((n,s)=>n+s.formulaCount,0)!==149)throw new Error('TASK_NATIVE_FORMULA_COUNT_MISMATCH');
  const results=[];
  for(const [index,sheet] of SHEETS.entries()) {
    if(!selectedSheets.includes(sheet))continue;
    const native=calculation.find(s=>s.index===index+1);if(!native)throw new Error('TASK_NATIVE_CALCULATION_EVIDENCE_MISSING');
    const rawPdf=await readFile(path.join(output,'sheet-'+(index+1)+'.pdf'));
    // Owner's three-sheet source exports Pooling as a single 960 x 1358.13
    // coordinate page on this driver (A4 / 0.62), despite PageSetup.Zoom=66.
    // Restore its observed physical coordinates; never alter worksheet Zoom.
    const coordinateZoom=index===4?62:Number(native.zoom);
    const corrected=index>=3?await restoreNativeA4Coordinates(rawPdf,coordinateZoom):{bytes:rawPdf,nativeCoordinateScale:1},pdf=corrected.bytes;
    const loading=getDocument({data:new Uint8Array(pdf),useSystemFonts:false});
    const document=await loading.promise;
    try {
      if(document.numPages!==PAGE_COUNTS[index])throw new Error('TASK_PDF_PAGE_COUNT:'+sheet+':'+document.numPages);
      const pages=[];
      for(let p=1;p<=document.numPages;p++) {
        const page=await document.getPage(p), viewport=page.getViewport({scale:1});
        const width=viewport.width,height=viewport.height;
        if(Math.abs(width-595.28)>2||Math.abs(height-841.89)>2)throw new Error('TASK_PDF_A4_PORTRAIT_REQUIRED:'+sheet+':'+p);
        const content=await page.getTextContent();
        const fonts=Object.values(content.styles).map(style=>style.fontFamily);
        pages.push({page:p,width,height,fonts,textItems:content.items.length});
      }
      results.push({sheet,bytes:pdf,sha256:sha256(pdf),pageCount:Number(PAGE_COUNTS[index]),pages,formulaCount:native.formulaCount,formulaErrors:native.formulaErrors,poolingCalculation:native.poolingCalculation,renderer:'Microsoft Excel' as const,goldenFidelityVerified:false as const,nativeCoordinateScale:corrected.nativeCoordinateScale});
    } finally {await loading.destroy();}
  }
  return results;
}

async function exportThroughHostSpool(bytes:Buffer,selectedSheets:readonly string[]) {
  const spool=process.env.NIPT_NATIVE_EXCEL_SPOOL;
  if(!spool||!path.isAbsolute(spool)||bytes.length<4||bytes.length>20*1024*1024)throw new Error('TASK_NATIVE_EXCEL_SPOOL_INVALID');
  const indexes=SHEETS.flatMap((sheet,i)=>selectedSheets.includes(sheet)?[i+1]:[]);
  if(!indexes.length||new Set(indexes).size!==indexes.length)throw Error('TASK_SHEET_REQUIRED');
  const inbox=path.join(spool,'inbox'),outbox=path.join(spool,'outbox'),id=randomUUID();
  const input=path.join(inbox,id+'.xlsx'),request=path.join(inbox,id+'.json'),temporary=path.join(inbox,id+'.json.tmp'),output=path.join(outbox,id);
  await mkdir(inbox,{recursive:true});await mkdir(outbox,{recursive:true});
  try {
    await writeFile(input,bytes,{flag:'wx'});
    await writeFile(temporary,JSON.stringify({version:1,id,sheets:indexes}),{flag:'wx'});
    await rename(temporary,request);
    const until=Date.now()+210000;
    while(Date.now()<until) {
      let raw:string;
      try {raw=await readFile(path.join(output,'status.json'),'utf8');}
      catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'){await pause(250);continue;}throw error;}
      const status=JSON.parse(raw) as {ok?:boolean;code?:string};
      if(status.ok!==true)throw new Error(typeof status.code==='string'&&/^[A-Z0-9_]{2,80}$/.test(status.code)?status.code:'TASK_NATIVE_EXCEL_FAILED');
      return await verifyNativeOutput(output,selectedSheets);
    }
    throw new Error('TASK_NATIVE_EXCEL_TIMEOUT');
  } finally {
    await rm(temporary,{force:true}).catch(()=>{});
    await rm(request,{force:true}).catch(()=>{});
    await rm(input,{force:true}).catch(()=>{});
    await rm(output,{recursive:true,force:true}).catch(()=>{});
  }
}

/** Microsoft Excel supplies native rendering. The host-spool mode uses a fixed local bind mount and never opens a network listener. */
export async function exportTaskPdfs(bytes:Buffer,selectedSheets:readonly string[]=SHEETS) {
  if(process.env.NIPT_NATIVE_EXCEL_SPOOL)return exportThroughHostSpool(bytes,selectedSheets);
  if(process.platform!=='win32')throw new Error('TASK_NATIVE_EXCEL_WINDOWS_REQUIRED');
  const temp=await mkdtemp(path.join(tmpdir(),'nipt-task-'));
  try {
    const input=path.join(temp,'task.xlsx'), output=path.join(temp,'pdf');
    await writeFile(input,bytes,{flag:'wx'});
    const indexes=SHEETS.flatMap((sheet,i)=>selectedSheets.includes(sheet)?[i+1]:[]);if(!indexes.length)throw Error('TASK_SHEET_REQUIRED');
    const pidFile=path.join(temp,'office.pid');
    try {
      await run(process.env.NIPT_NATIVE_POWERSHELL??'pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',path.join(process.cwd(),'packages/workbook/native-export.ps1'),'-InputWorkbook',input,'-OutputDirectory',output,'-SheetIndices',indexes.join(',')],{windowsHide:true,maxBuffer:1024*1024,timeout:180000,env:{...process.env,NIPT_OFFICE_PID_FILE:pidFile}});
    } catch(error) {
      // a script stopped by its timeout cannot quit Excel itself: stop exactly the instance it started, then report the original failure
      await stopOwnOfficeInstance(pidFile,'EXCEL.EXE');
      throw error;
    }
    return await verifyNativeOutput(output,selectedSheets);
  } finally {await rm(temp,{recursive:true,force:true});}
}
