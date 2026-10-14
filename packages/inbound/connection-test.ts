import {promises as fs} from 'node:fs';
import {confined} from '../storage';
import {assertSimulatorRoot} from '../integrations/scanner';
import {parsePet} from '../integrations/pet';
import {lookbackFolders} from './discovery';
import {sectionOf,classifyPet,NIPT_SECTION,MAX_PET_BYTES} from './wire';
import {type InboundSource,inboundReadError,inboundAccessError} from './source';

export interface ConnectionReport{passed:boolean;checks:{code:string;passed:boolean}[];dayFolders:number;petFiles:number;pairedPetFiles:number;sampleParse:'PASSED'|'FAILED'|'NO_SAMPLE';errorCode:string|null;}

/**
 * Plan §10.1 Test Connection on the simulator: marker → list → count day folders → find a `.pet/.ok` pair →
 * parse one sample in memory. Read-only (no mkdir/touch/write). The report carries counts and codes only, no PHI.
 */
export async function testInboundConnection(root:string,options:{lookbackDays?:number;now?:Date;source?:InboundSource}={}):Promise<ConnectionReport>{
 const file=(rel:string)=>options.source?options.source.file(rel):confined(root,rel);
 const checks:ConnectionReport['checks']=[],report:ConnectionReport={passed:false,checks,dayFolders:0,petFiles:0,pairedPetFiles:0,sampleParse:'NO_SAMPLE',errorCode:null};
 try{if(options.source)await options.source.assert();else await assertSimulatorRoot(root);checks.push({code:'SYNTHETIC_ROOT_MARKER',passed:true});}
 catch(e){checks.push({code:'SYNTHETIC_ROOT_MARKER',passed:false});report.errorCode=inboundAccessError(e);return report;}
 let inbound:string;
 try{inbound=options.source?root:await file('inbound');const st=await fs.lstat(inbound);if(!st.isDirectory())throw Error('INBOUND_DIRECTORY_REQUIRED');checks.push({code:'INBOUND_DIRECTORY',passed:true});}
 catch(e){checks.push({code:'INBOUND_DIRECTORY',passed:false});report.errorCode=inboundAccessError(e);return report;}
 let sample:{bytes:Buffer;name:string}|null=null;
 for(const day of lookbackFolders(options.lookbackDays??3,options.now??new Date())){
  let names:string[];try{names=await fs.readdir(await file('inbound/'+day));}catch(e){if(inboundReadError(e))continue;report.errorCode=inboundAccessError(e);checks.push({code:report.errorCode,passed:false});return report;}
  report.dayFolders++;
  for(const name of names.sort()){
   const s=sectionOf(name);if(!s||s.section!==NIPT_SECTION)continue;report.petFiles++;
   try{const ok=await fs.lstat(await file(`inbound/${day}/${name.replace(/\.pet$/i,'.ok')}`));if(!ok.isFile())throw Error('SHARE_NOT_FILE');}catch(e){if(inboundReadError(e))continue;report.errorCode=inboundAccessError(e);checks.push({code:report.errorCode,passed:false});return report;}
   report.pairedPetFiles++;
   if(!sample){const path=await file(`inbound/${day}/${name}`),st=await fs.lstat(path);if(st.isFile()&&st.size<=MAX_PET_BYTES){const bytes=await fs.readFile(path);if(classifyPet(bytes)==='NIPT')sample={bytes,name};}}
  }
 }
 checks.push({code:'DAY_FOLDERS_FOUND',passed:report.dayFolders>0},{code:'PET_OK_PAIR_FOUND',passed:report.pairedPetFiles>0});
 if(sample){try{parsePet(sample.bytes,sample.name);report.sampleParse='PASSED';}catch(e){report.sampleParse='FAILED';report.errorCode=inboundAccessError(e);}finally{sample.bytes.fill(0);}}
 checks.push({code:'SAMPLE_PARSE',passed:report.sampleParse==='PASSED'});
 report.passed=checks.every(c=>c.passed);
 return report;
}
