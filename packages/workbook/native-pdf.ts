import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {SHEETS} from './master';
import {sha256} from './archive';
const run=promisify(execFile);
/** Microsoft Excel supplies native rendering. A successful native render alone is not a golden-image fidelity pass. */
export async function exportTaskPdfs(bytes:Buffer) {
  if(process.platform!=='win32')throw new Error('TASK_NATIVE_EXCEL_WINDOWS_REQUIRED');
  const temp=await mkdtemp(path.join(tmpdir(),'nipt-task-'));
  try {
    const input=path.join(temp,'task.xlsx'), output=path.join(temp,'pdf');
    await writeFile(input,bytes,{flag:'wx'});
    await run(process.env.NIPT_NATIVE_POWERSHELL??'pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',path.join(process.cwd(),'packages/workbook/native-export.ps1'),'-InputWorkbook',input,'-OutputDirectory',output],{windowsHide:true,maxBuffer:1024*1024,timeout:180000});
    const calculation=JSON.parse(await readFile(path.join(output,'native-manifest.json'),'utf8')) as {index:number;formulaCount:number;formulaErrors:{cell:string;error:string}[];poolingCalculation:null|{D52:number|null;F52:number;D55:number;F52Formula:string;D55Formula:string}}[];
    if(calculation.length!==6||calculation.reduce((n,s)=>n+s.formulaCount,0)!==149)throw new Error('TASK_NATIVE_FORMULA_COUNT_MISMATCH');
    const results=[];
    for(const [index,sheet] of SHEETS.entries()) {
      const pdf=await readFile(path.join(output,`sheet-${index+1}.pdf`));
      const loading=getDocument({data:new Uint8Array(pdf),useSystemFonts:false});
      const document=await loading.promise;
      try {
        if(index<3&&document.numPages!==2)throw new Error(`TASK_PDF_PAGE_COUNT:${sheet}:${document.numPages}`);
        const pages=[];
        for(let p=1;p<=document.numPages;p++) {
          const page=await document.getPage(p), viewport=page.getViewport({scale:1});
          const width=viewport.width,height=viewport.height;
          if(index<3&&(Math.abs(width-595.28)>2||Math.abs(height-841.89)>2))throw new Error(`TASK_PDF_A4_PORTRAIT_REQUIRED:${sheet}:${p}`);
          const content=await page.getTextContent();
          const fonts=Object.values(content.styles).map(style=>style.fontFamily);
          pages.push({page:p,width,height,fonts,textItems:content.items.length});
        }
        const native=calculation.find(s=>s.index===index+1);if(!native)throw new Error('TASK_NATIVE_CALCULATION_EVIDENCE_MISSING');
        results.push({sheet,bytes:pdf,sha256:sha256(pdf),pageCount:document.numPages,pages,formulaCount:native.formulaCount,formulaErrors:native.formulaErrors,poolingCalculation:native.poolingCalculation,renderer:'Microsoft Excel' as const,goldenFidelityVerified:false as const});
      } finally {await loading.destroy();}
    }
    return results;
  } finally {await rm(temp,{recursive:true,force:true});}
}
