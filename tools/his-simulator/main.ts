import {pathToFileURL} from 'node:url';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {syntheticPet} from '../../packages/integrations/pet';
import {immutableWrite} from '../../packages/storage';
import {simulatorRoot} from '../../packages/integrations/scanner';
import {syntheticReportPdf,zipAsPdf,syntheticZip} from './result-pdf';
export async function generateSyntheticPairs(count=100,date=new Date()){if(count<1||count>1000)throw Error('INVALID_COUNT');await immutableWrite(simulatorRoot(),'.nipt-synthetic-root',Buffer.from('NIPT_SYNTHETIC_ONLY_V1'));await mkdir(path.join(simulatorRoot(),'outbound'),{recursive:true});const day=date.toLocaleDateString('en-CA',{timeZone:'Asia/Bangkok'}).replace(/-/g,'');for(let i=0;i<count;i++){const p=syntheticPet(i);await immutableWrite(simulatorRoot(),`inbound/${day}/${p.filename}`,p.bytes);await immutableWrite(simulatorRoot(),`inbound/${day}/${p.filename.replace('.pet','.ok')}`,Buffer.alloc(0));}return count;}
/** P5: a synthetic result folder shaped like NIPTY's NIPTPDFresult (sub-folders, real PDFs, ZIP-as-PDF, batch ZIP, a notice and one bad file). */
export async function generateSyntheticResults(){
 const root=simulatorRoot(),put=(rel:string,bytes:Buffer)=>immutableWrite(root,`results/${rel}`,bytes);
 const base={collection:'10-Oct-2026'};
 await put('2026-10/SYNTHETIC-SINGLETON-001.pdf',syntheticReportPdf({kind:'SINGLETON',labNumber:'26B261010001-1',hn:'990000000001',...base}));
 await put('2026-10/SYNTHETIC-TWIN-002.pdf',syntheticReportPdf({kind:'TWIN',labNumber:'26B261010002D-1',hn:'990000000002',...base}));
 await put('2026-10/SYNTHETIC-HIGHRISK-003.pdf',syntheticReportPdf({kind:'SINGLETON',labNumber:'26B261010003-1',hn:'990000000003',risks:['High Risk','Low Risk','Low Risk'],...base}));
 await put('2026-10/ZIP-AS-PDF-004.pdf',zipAsPdf({kind:'SINGLETON',labNumber:'26B261010004-1',hn:'990000000004',...base}));
 await put('2026-10/re-sampling notice 005.pdf',syntheticReportPdf({kind:'NOTICE',labNumber:'26B261010005-1',hn:'990000000005',...base}));
 await put('batch/SYNTHETIC-BATCH-006.zip',syntheticZip([{name:'SYNTHETIC-006.pdf',data:syntheticReportPdf({kind:'SINGLETON',labNumber:'26B261010006-1',hn:'990000000006',...base}),deflate:true},{name:'SYNTHETIC-007.pdf',data:syntheticReportPdf({kind:'SINGLETON',labNumber:'26B261010007-1',hn:'990000000007',...base}),deflate:true}]));
 await put('NOT-A-REPORT.pdf',Buffer.from('<html>synthetic malformed file</html>'));
 return 7;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)generateSyntheticPairs().then(async n=>console.log(JSON.stringify({code:'SYNTHETIC_PAIRS_CREATED',count:n,results:await generateSyntheticResults()}))).catch(()=>{process.stderr.write('SIMULATOR_FAILED\n');process.exitCode=1;});
