import {randomUUID} from 'node:crypto';
import * as fs from 'node:fs/promises';
import {SETTINGS} from './catalog';
import {operationalDataEnabled} from '../security/runtime';
import {openInboundSource} from '../inbound/source';
import {testInboundConnection} from '../inbound/connection-test';
import {shareError,openAuthorizedDirectory} from '../integrations/authorized-share';
import {simulatorRoot} from '../integrations/scanner';

/** Synchronous, read-mostly folder checks used when an administrator saves a HIS setting. They run in the request, with the same share policy and service
 *  identity the worker uses (web and worker run as the same Windows account), and report a stable code instead of queueing anything. */
const withTimeout=<T>(work:Promise<T>,ms=20000)=>Promise.race([work,new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('SHARE_CHECK_TIMEOUT')),ms))]);

/** Inbound PET folder: marker/access, day folders in the look-back window, PET+OK pairs, one sample parsed in memory. Counts and codes only. */
export async function probeInbound(value:Record<string,unknown>){
 const s=SETTINGS.his_inbound.schema.parse(value);
 const source=await withTimeout(openInboundSource(s.basePath,s.secretRef));
 const root=s.basePath==='simulator/inbound'?simulatorRoot():s.basePath;
 return withTimeout(testInboundConnection(root,{source,lookbackDays:s.lookbackDays}));
}

/** Rejects (with a stable share error code) when a folder of the saved HIS setting cannot be used. */
export async function checkHisSetting(key:'his_inbound'|'his_outbound',value:Record<string,unknown>):Promise<void>{
 if(key==='his_inbound'){
  const report=await probeInbound(value);
  // A readable PET root with no day folder / pair yet is a valid folder (new server, just after midnight); unreadable or unparsable files are not.
  const accessFailed=report.checks.some(c=>c.code!=='DAY_FOLDERS_FOUND'&&c.code!=='PET_OK_PAIR_FOUND'&&c.code!=='SAMPLE_PARSE'&&!c.passed);
  const parseFailed=report.sampleParse==='FAILED';
  if(accessFailed||parseFailed)throw Error(report.errorCode&&/^[A-Z0-9_]+$/.test(report.errorCode)?report.errorCode:'HIS_PATH_NOT_ACCESSIBLE');
  return;
 }
 const s=SETTINGS.his_outbound.schema.parse(value);
 // Synthetic runtime: destinations are simulator folders checked when the sandbox transfer runs; real shares are probed with a read/write/readback file.
 if(!operationalDataEnabled())return;
 try{
  for(const input of [s.resDestinationPath,s.pdfDestinationPath,s.backupPath]){
   const directory=await withTimeout(openAuthorizedDirectory(input,'OUTBOUND',s.secretRef)),name='.nipt-connection-probe-'+randomUUID();
   const filename=await directory.file(name,true),bytes=Buffer.from('NIPT CONNECTION PROBE\n');let created=false;
   try{const h=await fs.open(filename,'wx',0o600);created=true;try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}
    if(!(await fs.readFile(await directory.file(name))).equals(bytes))throw Error('SHARE_READBACK_MISMATCH');
   }finally{if(created)await fs.unlink(await directory.file(name));}
  }
 }catch(e){throw Error(shareError(e));}
}
