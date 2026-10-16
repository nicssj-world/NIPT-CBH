import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {operationalTestPetBytes} from './test-pet-fixture';
import {syntheticReportPdf} from '../his-simulator/result-pdf';

type PatientFixture={fixtureId:string;ln:string;hn:string;day:string;pet:string;ok:string;scenario:string};
const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const localRoot=path.resolve('.local/home-operational-uat');
function localPath(envName:string,fallback:string) {
 const destination=path.resolve(process.env[envName]??fallback),relative=path.relative(localRoot,destination);
 if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('LOCAL_UAT_FIXTURE_PATH_REQUIRED');
 return destination;
}
function localDay(date=new Date()) {
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
 const map=Object.fromEntries(parts.map(part=>[part.type,part.value]));
 return map.year+map.month+map.day;
}
async function writeOnce(file:string,bytes:Buffer) {
 try {const existing=await readFile(file);if(!existing.equals(bytes))throw Error('LOCAL_UAT_FIXTURE_FILE_CONFLICT');}
 catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;await writeFile(file,bytes,{flag:'wx'});}
}
const cases:PatientFixture[]=[];
const day=localDay(),yyMMdd=day.slice(2);
if(process.env.NIPT_MODE!=='operational')throw Error('OPERATIONAL_MODE_REQUIRED');
const pdfDate=day.slice(6,8)+'-'+new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Bangkok',month:'short'}).format(new Date(day.slice(0,4)+'-'+day.slice(4,6)+'-'+day.slice(6,8)+'T12:00:00'))+'-'+day.slice(0,4);
const fixtureRoot=localPath('NIPT_HOME_UAT_FIXTURE_ROOT','.local/home-operational-uat/fixtures');
const petRoot=path.join(fixtureRoot,'pet'),reportRoot=path.join(fixtureRoot,'reports');
const simRoot=localPath('NIPT_HOME_UAT_SIMULATOR_ROOT','.local/home-operational-uat/integration');
const marker=path.join(fixtureRoot,'fixture-manifest.json');
try {
 const previous=JSON.parse(await readFile(marker,'utf8')) as {version:number;day:string;patients:PatientFixture[];files:{path:string;sha256:string}[]};
 if(previous.version!==1||!Array.isArray(previous.files))throw Error('LOCAL_UAT_FIXTURE_MANIFEST_INVALID');
 for(const file of previous.files)if(hash(await readFile(path.join(fixtureRoot,file.path)))!==file.sha256)throw Error('LOCAL_UAT_FIXTURE_INTEGRITY_MISMATCH');
 process.stdout.write('HOME_UAT_FIXTURES_READY existing=true patientFixtures='+previous.patients.length+' day='+previous.day+'\n');
 process.exit(0);
} catch(error) {if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
await mkdir(petRoot,{recursive:true});await mkdir(reportRoot,{recursive:true});await mkdir(path.join(simRoot,'inbound'),{recursive:true});
for(let i=0;i<45;i++) {
 const serial=9701+i,ln=yyMMdd+String(serial).padStart(6,'0'),hn=String(serial).padStart(8,'0')+'/69';
 const fixtureId=i===0?'S1-01':i===1?'TWIN-01':i===2?'RE-LIB-01':i===3?'S2-01':'BATCH-'+String(i+1).padStart(2,'0');
 const pet='pet/'+ln+'-7.pet',ok='pet/'+ln+'-7.ok';
 const scenario=i===0?'Singleton S1':i===1?'Owner selects Twin in the request form':i===2?'Re-Library review case':i===3?'S2 after an approved resampling/redraw action':'Task-list capacity fixture; enter test data through the application';
 const record={fixtureId,ln,hn,day,pet,ok,scenario};
 const petBytes=operationalTestPetBytes({ln,hn,day});
 await writeOnce(path.join(fixtureRoot,pet),petBytes);await writeOnce(path.join(fixtureRoot,ok),Buffer.alloc(0));
 cases.push(record);
}
const first=cases[0],twin=cases[1];
const reports=[
 {name:'LOCAL-TEST-NEGATIVE.pdf',spec:{kind:'SINGLETON' as const,labNumber:first.ln,hn:first.hn,name:'SYNTHETIC LOCAL TEST',collection:pdfDate,risks:['Low Risk','Low Risk','Low Risk'] as [string,string,string]}},
 {name:'LOCAL-TEST-TWIN.pdf',spec:{kind:'TWIN' as const,labNumber:twin.ln,hn:twin.hn,name:'SYNTHETIC LOCAL TEST TWIN',collection:pdfDate}},
 {name:'LOCAL-TEST-POSITIVE.pdf',spec:{kind:'SINGLETON' as const,labNumber:cases[2].ln,hn:cases[2].hn,name:'SYNTHETIC LOCAL TEST',collection:pdfDate,risks:['High Risk','Low Risk','Low Risk'] as [string,string,string]}},
 {name:'LOCAL-TEST-RESAMPLING-NOTICE.pdf',spec:{kind:'NOTICE' as const,labNumber:cases[3].ln,hn:cases[3].hn,name:'SYNTHETIC LOCAL TEST',collection:pdfDate,notice:'SYNTHETIC TEST ONLY - re-sampling recommended'}},
];
const files:{path:string;sha256:string}[]=[];
for(const patient of cases)for(const relative of [patient.pet,patient.ok])files.push({path:relative,sha256:hash(await readFile(path.join(fixtureRoot,relative)))});
for(const report of reports) {
 const relative='reports/'+report.name,bytes=syntheticReportPdf(report.spec);
 await writeOnce(path.join(fixtureRoot,relative),bytes);files.push({path:relative,sha256:hash(bytes)});
}
const manifest={version:1,environment:'LOCAL_UAT_TEST_FIXTURES_ONLY',day,patients:cases,controls:[{id:'PC',type:'positive control',source:'Create only through controlled batch workflow'},{id:'NC',type:'negative control',source:'Create only through controlled batch workflow'},{id:'BLANK',type:'blank control',source:'Create only through controlled batch workflow'}],files};
await writeFile(marker,JSON.stringify(manifest,null,2),{flag:'wx'});
const lines=['fixtureId,ln,hn,collectionDay,scenario',...cases.map(row=>[row.fixtureId,row.ln,row.hn,row.day,JSON.stringify(row.scenario)].join(',')),'','Controls,PC / NC / BLANK,Enter through the controlled task workflow only'];
await writeFile(path.join(fixtureRoot,'case-list.csv'),lines.join('\r\n'),{flag:'wx'});
process.stdout.write('HOME_UAT_FIXTURES_READY existing=false patientFixtures='+cases.length+' localReportFixtures='+reports.length+' day='+day+'\n');
