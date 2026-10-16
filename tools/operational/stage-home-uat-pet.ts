import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {operationalTestPetBytes} from './test-pet-fixture';
type Manifest={patients:{fixtureId:string;ln:string;hn:string;day:string}[]};
function within(root:string,target:string) {
 const relative=path.relative(root,target);
 return relative!==''&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);
}
const root=path.resolve('.local/integrated-owner-uat');
const fixtures=path.resolve(process.env.NIPT_HOME_UAT_FIXTURE_ROOT??path.join(root,'fixtures'));
const simulator=path.resolve(process.env.NIPT_HOME_UAT_SIMULATOR_ROOT??path.join(root,'integration'));
if(!within(root,fixtures)||!within(root,simulator))throw Error('LOCAL_UAT_STAGE_PATH_REQUIRED');
const fixtureId=process.env.NIPT_HOME_UAT_FIXTURE_ID??'';
const round=Number(process.env.NIPT_HOME_UAT_ROUND??'1');
if(process.env.NIPT_MODE!=='operational')throw Error('OPERATIONAL_MODE_REQUIRED');
if(!/^(?:S1-01|TWIN-01|RE-LIB-01|S2-01|BATCH-\d{2})$/.test(fixtureId)||![1,2].includes(round))throw Error('LOCAL_UAT_FIXTURE_ID_REQUIRED');
const manifest=JSON.parse(await readFile(path.join(fixtures,'fixture-manifest.json'),'utf8')) as Manifest;
const patient=manifest.patients.find(row=>row.fixtureId===fixtureId);
if(!patient)throw Error('LOCAL_UAT_FIXTURE_NOT_FOUND');
const dayPath=patient.day;
if(!/^\d{8}$/.test(dayPath))throw Error('LOCAL_UAT_FIXTURE_DATE_INVALID');
const destination=path.join(simulator,'inbound',dayPath);
if(!within(simulator,destination))throw Error('LOCAL_UAT_STAGE_PATH_REQUIRED');
await mkdir(destination,{recursive:true});
const time=round===1?'100000':'120000';
const petBytes=operationalTestPetBytes({ln:patient.ln,hn:patient.hn,day:dayPath,time});
const petPath=path.join(destination,patient.ln+'-7.pet'),okPath=path.join(destination,patient.ln+'-7.ok');
async function current(file:string){try{return await readFile(file);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}}
const existing=await current(petPath);
if(existing&&!existing.equals(petBytes)) {
 const firstRound=operationalTestPetBytes({ln:patient.ln,hn:patient.hn,day:dayPath,time:'100000'});
 if(round!==2||!existing.equals(firstRound))throw Error('LOCAL_UAT_PET_TARGET_CONFLICT');
 await writeFile(petPath,petBytes);
} else if(!existing)await writeFile(petPath,petBytes,{flag:'wx'});
const ok=await current(okPath);
if(!ok)await writeFile(okPath,Buffer.alloc(0),{flag:'wx'});
else if(ok.length!==0)throw Error('LOCAL_UAT_OK_TARGET_CONFLICT');
process.stdout.write('LOCAL_HIS_PET_STAGED fixture='+fixtureId+' round='+round+' destination=LOCAL_ONLY\n');
