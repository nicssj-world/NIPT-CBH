/** Real Excel evidence for the owner-approved generated Control fills. */
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import {generateTaskWorkbook,MASTER_SHA256,SHEETS} from '../../packages/workbook/master';
import {sha256} from '../../packages/workbook/archive';
import {exportTaskPdfs} from '../../packages/workbook/native-pdf';
const source=process.env.NIPT_TASK_MASTER_PATH;if(!source)throw Error('LOCKED_MASTER_REQUIRED');
const master=await readFile(source),root=await mkdtemp(path.resolve('.local/control-highlights-'));
assert.equal(sha256(master),MASTER_SHA256);
const generated=generateTaskWorkbook(master,{'slot.1.printedSampleId':'PC','slot.25.printedSampleId':'NC','slot.40.printedSampleId':'BLANK'});
await writeFile(path.join(root,'generated.xlsx'),generated.bytes);
for(const [label,bytes]of [['master',master],['generated',generated.bytes]] as const){
 const pdfs=await exportTaskPdfs(bytes,SHEETS.slice(0,3));
 for(const [i,pdf]of pdfs.entries()){assert.equal(pdf.pageCount,2);await writeFile(path.join(root,`${label}-${i+1}.pdf`),pdf.bytes);}
 await writeFile(path.join(root,label+'-native.json'),JSON.stringify(pdfs.map(({bytes:_,...meta})=>{void _;return meta;}),null,2));
}
execFileSync('python',['tools/operational/verify-control-highlights.py',root],{stdio:'inherit',windowsHide:true});
assert.equal(sha256(await readFile(source)),MASTER_SHA256);
await writeFile(path.join(root,'provenance.json'),JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),masterSha256:MASTER_SHA256,generatedSha256:generated.sha256,timestamp:new Date().toISOString(),masterUnchanged:true,pageCounts:[2,2,2],ownerVisualAcceptance:'NOT_RUN'},null,2));
process.stdout.write(root+'\n');
