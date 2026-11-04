// Focused native check: node --import tsx tests/native/workbook-master-pdf.ts
// Approved template copied under .local/dev; all editable inputs are synthetic.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {inspectTaskMaster,generateTaskWorkbook,SHEETS} from '../../packages/workbook/master';
import {exportTaskPdfs} from '../../packages/workbook/native-pdf';

// Always use the local test renderer; never an installed environment's spool.
delete process.env.NIPT_NATIVE_EXCEL_SPOOL;
const root=path.resolve('.local/dev');
const master=await readFile(path.join(root,'data/master/approved-master.xlsx'));
const matrix=inspectTaskMaster(master);
const values:Record<string,unknown>=Object.fromEntries(matrix.bindings.map(binding=>[
 binding.key,binding.dataType==='text'?'':binding.dataType==='number'?0:false,
]));
for(let sheet=1;sheet<=3;sheet++)Object.assign(values,{
 [`task.${sheet}.run`]:'Run999/2026',
 [`task.${sheet}.date`]:'05/11/2569',
 [`task.${sheet}.operator`]:'SYNTHETIC PDF CHECK',
});
for(let slot=1;slot<=48;slot++)values[`slot.${slot}.printedSampleId`]=`SYN-${slot}`;
const workbook=generateTaskWorkbook(master,values);
const out=path.join(root,'runs',`native-master-${Date.now()}`);
await mkdir(out,{recursive:true});
await writeFile(path.join(out,'synthetic.xlsx'),workbook.bytes);
const started=Date.now();
const pdfs=await exportTaskPdfs(workbook.bytes);
assert.equal(pdfs.length,6);
assert.equal(pdfs.reduce((total,pdf)=>total+pdf.formulaCount,0),149);
for(const [index,sheet] of SHEETS.entries()){
 const pdf=pdfs.find(pdf=>pdf.sheet===sheet)!;
 assert.equal(pdf.pageCount,index<3?2:1);
 await writeFile(path.join(out,`sheet-${index+1}.pdf`),pdf.bytes);
}
const evidence={pass:true,formulaCount:149,pages:pdfs.map(pdf=>pdf.pageCount),elapsedMs:Date.now()-started,out};
await writeFile(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence));
