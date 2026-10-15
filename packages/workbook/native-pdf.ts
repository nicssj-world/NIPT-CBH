import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {SHEETS} from './master';
import {sha256} from './archive';
import {restoreNativeA4Coordinates} from './pdf-media';
const run=promisify(execFile);
/** Microsoft Excel supplies native rendering. A successful native render alone is not a golden-image fidelity pass. */
export async function exportTaskPdfs(bytes:Buffer,selectedSheets:readonly string[]=SHEETS) {
  if(process.platform!=='win32')throw new Error('TASK_NATIVE_EXCEL_WINDOWS_REQUIRED');
  const temp=await mkdtemp(path.join(tmpdir(),'nipt-task-'));
  try {
    const input=path.join(temp,'task.xlsx'), output=path.join(temp,'pdf');
    await writeFile(input,bytes,{flag:'wx'});
    const indexes=SHEETS.flatMap((sheet,i)=>selectedSheets.includes(sheet)?[i+1]:[]);if(!indexes.length)throw Error('TASK_SHEET_REQUIRED');
    await run(process.env.NIPT_NATIVE_POWERSHELL??'pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',path.join(process.cwd(),'packages/workbook/native-export.ps1'),'-InputWorkbook',input,'-OutputDirectory',output,'-SheetIndices',indexes.join(',')],{windowsHide:true,maxBuffer:1024*1024,timeout:180000});
    const calculation=JSON.parse(await readFile(path.join(output,'native-manifest.json'),'utf8')) as {index:number;zoom:number|false;formulaCount:number;formulaErrors:{cell:string;error:string}[];poolingCalculation:null|{D52:number|null;F52:number;D55:number;F52Formula:string;D55Formula:string}}[];
    if(calculation.length!==6||calculation.reduce((n,s)=>n+s.formulaCount,0)!==149)throw new Error('TASK_NATIVE_FORMULA_COUNT_MISMATCH');
    const results=[];
    for(const [index,sheet] of SHEETS.entries()) {
      if(!selectedSheets.includes(sheet))continue;
      const native=calculation.find(s=>s.index===index+1);if(!native)throw new Error('TASK_NATIVE_CALCULATION_EVIDENCE_MISSING');
      const rawPdf=await readFile(path.join(output,`sheet-${index+1}.pdf`));
      // Owner's three-sheet source exports Pooling as a single 960 x 1358.13
      // coordinate page on this driver (A4 / 0.62), despite PageSetup.Zoom=66.
      // Restore its observed physical coordinates; never alter worksheet Zoom.
      const coordinateZoom=index===4?62:Number(native.zoom);
      const corrected=index>=3?await restoreNativeA4Coordinates(rawPdf,coordinateZoom):{bytes:rawPdf,nativeCoordinateScale:1},pdf=corrected.bytes;
      const loading=getDocument({data:new Uint8Array(pdf),useSystemFonts:false});
      const document=await loading.promise;
      try {
        if(index<3&&document.numPages!==2)throw new Error(`TASK_PDF_PAGE_COUNT:${sheet}:${document.numPages}`);
        const pages=[];
        for(let p=1;p<=document.numPages;p++) {
          const page=await document.getPage(p), viewport=page.getViewport({scale:1});
          const width=viewport.width,height=viewport.height;
          if(Math.abs(width-595.28)>2||Math.abs(height-841.89)>2)throw new Error(`TASK_PDF_A4_PORTRAIT_REQUIRED:${sheet}:${p}`);
          const content=await page.getTextContent();
          const fonts=Object.values(content.styles).map(style=>style.fontFamily);
          pages.push({page:p,width,height,fonts,textItems:content.items.length});
        }
        results.push({sheet,bytes:pdf,sha256:sha256(pdf),pageCount:document.numPages,pages,formulaCount:native.formulaCount,formulaErrors:native.formulaErrors,poolingCalculation:native.poolingCalculation,renderer:'Microsoft Excel' as const,goldenFidelityVerified:false as const,nativeCoordinateScale:corrected.nativeCoordinateScale});
      } finally {await loading.destroy();}
    }
    return results;
  } finally {await rm(temp,{recursive:true,force:true});}
}
