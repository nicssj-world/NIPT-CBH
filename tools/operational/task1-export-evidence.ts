/** Synthetic, local Owner Task1 derivative/native evidence. No database or HIS connection. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {generateTaskWorkbook,inspectTaskMaster,MASTER_SHA256,SHEETS} from '../../packages/workbook/master';
import {exportTaskPdfs} from '../../packages/workbook/native-pdf';
import {readArchive,sha256} from '../../packages/workbook/archive';
import {buildTubeLabelsHtml} from '../../packages/lab/labels';
import {exportOwnerNifty,NIFTY_TEMPLATE_SHA256,type VendorPatient} from '../../packages/sequencing/owner-export';
import {exportOwnerTaskImport,TASK_IMPORT_TEMPLATE_SHA256} from '../../packages/sequencing/owner-task-import';
import {printedSampleId} from '../../packages/lab/rules';

const root=path.resolve(process.env.NIPT_TASK1_EXPORT_EVIDENCE_DIR??'.local/task1-owner-20261023/exports');await mkdir(root,{recursive:true});
const master=await readFile('.local/lab-owner-evidence/lab-combined-master.xlsx');
assert.equal(sha256(master),MASTER_SHA256);assert.equal(inspectTaskMaster(master).formulaCount,149);
const values:Record<string,unknown>={'slot.1.printedSampleId':'26N120261023-1','slot.25.printedSampleId':'26N220261023-1','slot.40.printedSampleId':'BLANK'};
for(let n=1;n<=3;n++)Object.assign(values,{[`task.${n}.run`]:'Run001/2026',[`task.${n}.date`]:'24/10/2569',[`task.${n}.operator`]:'SYNTHETIC CHANGED OPERATOR',[`task.${n}.extractionLotExp`]:'EX-B / 01/01/2570',[`task.${n}.libraryLotExp`]:'LIB-B / 01/02/2570'});
const identifiers=[
 {slot:2,base:'26B261023001',pregnancy:'Singleton' as const,roundNumber:4,attemptNumber:1,overallOrdinal:5,repeatLevel:null},
 {slot:3,base:'26B261023002',pregnancy:'Singleton' as const,roundNumber:3,attemptNumber:2,overallOrdinal:4,repeatLevel:'RE_LIBRARY' as const},
 {slot:17,base:'26B261023001',pregnancy:'Singleton' as const,roundNumber:4,attemptNumber:2,overallOrdinal:6,repeatLevel:'RE_EXTRACTION' as const},
 {slot:33,base:'26B261023003',pregnancy:'Twins' as const,roundNumber:5,attemptNumber:1,overallOrdinal:5,repeatLevel:null},
 {slot:4,base:'26B261023004',pregnancy:'Singleton' as const,roundNumber:3,attemptNumber:1,overallOrdinal:3,repeatLevel:null},
].map(input=>({...input,printed:printedSampleId({...input,earlierReLibraryCount:0,receivedSource:'HIS_PET_RECEIPT'})}));
assert.deepEqual(identifiers.map(x=>x.printed),['26B261023001R-1','26B261023002R-2','26B261023001R-1','26B261023003DR-1','26B261023004R-1']);
for(const i of identifiers)values[`slot.${i.slot}.printedSampleId`]=i.printed;
const generated=generateTaskWorkbook(master,values,{exceptionalSlots:[2,17,33]});
await writeFile(path.join(root,'task1-generated.xlsx'),generated.bytes);
const before=readArchive(master),after=readArchive(generated.bytes);
for(let n=1;n<=6;n++){
 const name=`xl/worksheets/sheet${n}.xml`,formulas=(x:string)=>[...x.matchAll(/<f\b[^>]*>[\s\S]*?<\/f>/g)].map(m=>m[0]);
 assert.deepEqual(formulas(after.get(name)!.toString()),formulas(before.get(name)!.toString()));
}
const native=await exportTaskPdfs(generated.bytes);
for(const [n,pdf]of native.entries())await writeFile(path.join(root,`task-${n+1}.pdf`),pdf.bytes);
const labels=buildTubeLabelsHtml([{ln:'990001234567',lnHalos:'26B261023001R',patientName:'SYNTHETIC ONLY'},{ln:'990001234568',lnHalos:'26B261023002DR',patientName:'SYNTHETIC ONLY'}]);
assert.equal((labels.match(/class="sticker"/g)??[]).length,8);assert.equal((labels.match(/class="(?:right|left) half"/g)??[]).length,16);
await writeFile(path.join(root,'S2-S3-label-preview.html'),labels);
const p:VendorPatient={slot:2,kind:'PATIENT',attemptId:'synthetic-attempt-5',caseId:'synthetic-case',roundId:'synthetic-S3',overallOrdinal:5,sampleId:'26B261023001R-1',ln:'990001234567',hn:'9900012345',name:'SYNTHETIC ONLY',identity:'',dob:'1990-01-01',collectionAt:'2026-10-23T08:00:00+07:00',receivedAt:'2026-10-23T10:00:00+07:00',edd:'2027-03-24',pregnancy:'Singleton',doctor:'SYNTHETIC ONLY'};
const niftyTemplate=await readFile('C:/Users/User/Downloads/NIFTY_Test_Request_FormHNZ_filled.xlsx'),halosTemplate=await readFile('C:/Users/User/Downloads/Task Import template(3).xlsx');
const nifty=exportOwnerNifty(niftyTemplate,[p,{slot:1,kind:'PC',sampleId:'26N120261023-1'},{slot:25,kind:'NC',sampleId:'26N220261023-1'}]);
const halos=exportOwnerTaskImport(halosTemplate,[{...p}],new Date('2026-10-23T08:00:00Z'));
await writeFile(path.join(root,'nifty-exceptional.xlsx'),nifty.bytes);await writeFile(path.join(root,'halos-exceptional.xlsx'),halos.bytes);
assert.equal(sha256(master),MASTER_SHA256);assert.equal(sha256(niftyTemplate),NIFTY_TEMPLATE_SHA256);assert.equal(sha256(halosTemplate),TASK_IMPORT_TEMPLATE_SHA256);
await writeFile(path.join(root,'manifest.json'),JSON.stringify({generatedAt:new Date().toISOString(),syntheticOnly:true,identifiers,masterSha256:MASTER_SHA256,masterUnchanged:true,sheets:SHEETS,formulaCount:149,formulasUnchanged:true,taskXlsxSha256:generated.sha256,native:native.map(({bytes:_,...meta})=>{void _;return meta;}),nifty:{templateSha256:NIFTY_TEMPLATE_SHA256,sha256:nifty.sha256,mapping:nifty.mapping},halos:{templateSha256:TASK_IMPORT_TEMPLATE_SHA256,sha256:halos.sha256,mapping:halos.mapping},limitations:['Vendor machine acceptance NOT VERIFIED','Physical label printing NOT VERIFIED','Vendor template style remains unchanged; exceptional red shown on Task derivatives only']},null,2));
process.stdout.write(root+'\n');
