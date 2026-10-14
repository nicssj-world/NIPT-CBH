/** Local native Excel verification against the exact external owner master. Never saves the master. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {inspectTaskMaster,generateTaskWorkbook,MASTER_SHA256} from '../../packages/workbook/master';
import {sha256,readArchive} from '../../packages/workbook/archive';
import {exportTaskPdfs} from '../../packages/workbook/native-pdf';
const masterPath=process.env.NIPT_TASK_MASTER_PATH;if(!masterPath)throw Error('NIPT_TASK_MASTER_PATH_REQUIRED');
const output=path.resolve('.local/workbook-verification/final');await mkdir(output,{recursive:true});
const master=await readFile(masterPath),matrix=inspectTaskMaster(master),values:Record<string,unknown>={};
for(const b of matrix.bindings)values[b.key]=b.dataType==='checkbox'?true:b.dataType==='number'?5:b.key.includes('printedSampleId')?'26B261014001':b.key.endsWith('.date')?'15/10/2026':b.key.endsWith('.run')?'Run001/2026':b.key.endsWith('transferChecked')?'✓':'ทดสอบ';
const filled=generateTaskWorkbook(master,values),before=readArchive(master),after=readArchive(filled.bytes);
for(const [name,bytes] of before){if(!filled.changedParts.includes(name))assert.ok(after.get(name)!.equals(bytes),name);if(name.startsWith('xl/worksheets/'))assert.deepEqual([...after.get(name)!.toString().matchAll(/<f\b[^>]*>[\s\S]*?<\/f>/g)].map(m=>m[0]),[...bytes.toString().matchAll(/<f\b[^>]*>[\s\S]*?<\/f>/g)].map(m=>m[0]));}
await writeFile(path.join(output,'field-binding-matrix.json'),JSON.stringify(matrix,null,2));await writeFile(path.join(output,'filled.xlsx'),filled.bytes);
const printerBefore=execFileSync('pwsh.exe',['-NoProfile','-Command',"$n=(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Windows' -Name Device).Device.Split(',')[0];(Get-PrintConfiguration -PrinterName $n).PrintTicketXML"],{encoding:'utf8',windowsHide:true});
const exports=await exportTaskPdfs(filled.bytes);
const printerAfter=execFileSync('pwsh.exe',['-NoProfile','-Command',"$n=(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Windows' -Name Device).Device.Split(',')[0];(Get-PrintConfiguration -PrinterName $n).PrintTicketXML"],{encoding:'utf8',windowsHide:true});assert.equal(printerAfter,printerBefore);
for(const [i,pdf] of exports.entries())await writeFile(path.join(output,`filled-sheet-${i+1}.pdf`),pdf.bytes);
assert.equal(sha256(await readFile(masterPath)),MASTER_SHA256);
const evidence={masterSha256:MASTER_SHA256,masterUnchanged:true,formulaCount:matrix.formulaCount,bindingCount:matrix.bindings.length,worksheets:6,allDeclaredBindingsPopulated:true,layoutPartsUnchanged:true,printerRestored:true,pdfs:exports.map(({bytes,...e})=>{void bytes;return e;}),visualFidelity:'REQUIRES_GOLDEN_VISUAL_COMPARISON'};
await writeFile(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));process.stdout.write(JSON.stringify(evidence)+'\n');
