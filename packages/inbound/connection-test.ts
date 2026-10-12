import {promises as fs} from 'node:fs';
import {confined} from '../storage';
import {assertSimulatorRoot} from '../integrations/scanner';
import {parsePet} from '../integrations/pet';
import {lookbackFolders} from './discovery';
import {sectionOf,classifyPet,NIPT_SECTION,MAX_PET_BYTES} from './wire';
import {errorCode} from './tx';

export interface ConnectionReport{passed:boolean;checks:{code:string;passed:boolean}[];dayFolders:number;petFiles:number;pairedPetFiles:number;sampleParse:'PASSED'|'FAILED'|'NO_SAMPLE';errorCode:string|null;}

/**
 * Plan §10.1 Test Connection on the simulator: marker → list → count day folders → find a `.pet/.ok` pair →
 * parse one sample in memory. Read-only (no mkdir/touch/write). The report carries counts and codes only, no PHI.
 */
export async function testInboundConnection(root:string,options:{lookbackDays?:number;now?:Date}={}):Promise<ConnectionReport>{
 const checks:ConnectionReport['checks']=[],report:ConnectionReport={passed:false,checks,dayFolders:0,petFiles:0,pairedPetFiles:0,sampleParse:'NO_SAMPLE',errorCode:null};
 try{await assertSimulatorRoot(root);checks.push({code:'SYNTHETIC_ROOT_MARKER',passed:true});}
 catch(e){checks.push({code:'SYNTHETIC_ROOT_MARKER',passed:false});report.errorCode=errorCode(e);return report;}
 let inbound:string;
 try{inbound=await confined(root,'inbound');const st=await fs.lstat(inbound);if(!st.isDirectory())throw Error('INBOUND_DIRECTORY_REQUIRED');checks.push({code:'INBOUND_DIRECTORY',passed:true});}
 catch(e){checks.push({code:'INBOUND_DIRECTORY',passed:false});report.errorCode=errorCode(e);return report;}
 let sample:{bytes:Buffer;name:string}|null=null;
 for(const day of lookbackFolders(options.lookbackDays??3,options.now??new Date())){
  let names:string[];try{names=await fs.readdir(await confined(root,'inbound/'+day));}catch{continue;}
  report.dayFolders++;
  for(const name of names.sort()){
   const s=sectionOf(name);if(!s||s.section!==NIPT_SECTION)continue;report.petFiles++;
   try{await fs.lstat(await confined(root,`inbound/${day}/${name.replace(/\.pet$/i,'.ok')}`));}catch{continue;}
   report.pairedPetFiles++;
   if(!sample){const path=await confined(root,`inbound/${day}/${name}`),st=await fs.lstat(path);if(st.isFile()&&st.size<=MAX_PET_BYTES){const bytes=await fs.readFile(path);if(classifyPet(bytes)==='NIPT')sample={bytes,name};}}
  }
 }
 checks.push({code:'DAY_FOLDERS_FOUND',passed:report.dayFolders>0},{code:'PET_OK_PAIR_FOUND',passed:report.pairedPetFiles>0});
 if(sample){try{parsePet(sample.bytes,sample.name);report.sampleParse='PASSED';}catch(e){report.sampleParse='FAILED';report.errorCode=errorCode(e);}finally{sample.bytes.fill(0);}}
 checks.push({code:'SAMPLE_PARSE',passed:report.sampleParse!=='FAILED'});
 report.passed=checks.every(c=>c.passed);
 return report;
}
