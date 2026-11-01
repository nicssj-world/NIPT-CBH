// Runs AS THE SERVICE IDENTITY (started by its own scheduled task through nipt-admin, from the release's ops folder with tsx):
// the same folder checks the application runs when an administrator saves a HIS path in Settings (packages/settings/his-check.ts),
// plus a raw operating-system probe so the real error code is visible instead of the application's generic one.
//   node --import tsx service-his-probe.mjs <request.json> <result.json> <ops dir>
// Request: { inbound?: { basePath, lookbackDays? }, outbound?: { resDestinationPath, pdfDestinationPath, backupPath } }
// Inbound is READ-ONLY (listing and one parse in memory). Outbound writes one temporary dot-file per destination, reads it back and
// removes it: the application's own Test. The result holds identity, counts and codes only: no file names, no contents, no secrets.
import {readFileSync,writeFileSync} from 'node:fs';
import {lstat,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const [requestFile,resultFile,opsDir]=process.argv.slice(2);
const request=JSON.parse(readFileSync(requestFile,'utf8'));
const load=async rel=>import(pathToFileURL(path.join(opsDir,rel)).href);
const {SETTINGS}=await load('packages/settings/catalog.ts');
const {checkHisSetting,probeInbound}=await load('packages/settings/his-check.ts');
const raw=async p=>{
 try{const st=await lstat(p);const out={reachable:true,directory:st.isDirectory()};if(st.isDirectory())out.entries=(await readdir(p)).length;return out;}
 catch(e){return {reachable:false,code:e.code??null,errno:e.errno??null,syscall:e.syscall??null};}
};
const result={at:new Date().toISOString(),identity:execFileSync(path.join(process.env.SystemRoot??'C:\\Windows','System32','whoami.exe'),[],{encoding:'utf8',windowsHide:true}).trim(),mode:process.env.NIPT_MODE,environment:process.env.NIPT_ENVIRONMENT??null};

if(request.inbound){
 const value={...SETTINGS.his_inbound.default,...(request.inbound.lookbackDays?{lookbackDays:request.inbound.lookbackDays}:{}),basePath:request.inbound.basePath,enabled:false};
 const inbound={path:request.inbound.basePath,os:await raw(request.inbound.basePath)};
 try{
  const report=await probeInbound(value);
  inbound.report={passed:report.passed,dayFolders:report.dayFolders,petFiles:report.petFiles,pairedPetFiles:report.pairedPetFiles,sampleParse:report.sampleParse,errorCode:report.errorCode,checks:report.checks};
 }catch(e){inbound.reportError=String(e?.message??e).slice(0,200);}
 try{await checkHisSetting('his_inbound',value);inbound.saveCheck='PASS';}catch(e){inbound.saveCheck='REFUSED: '+String(e?.message??e).slice(0,200);}
 result.inbound=inbound;
}
if(request.outbound){
 const o=request.outbound;
 const value=SETTINGS.his_outbound.schema.parse({...SETTINGS.his_outbound.default,enabled:false,target:'AUTHORIZED_SHARE',resDestinationPath:o.resDestinationPath,pdfDestinationPath:o.pdfDestinationPath,backupPath:o.backupPath});
 const outbound={paths:{res:o.resDestinationPath,pdf:o.pdfDestinationPath,backup:o.backupPath},os:{res:await raw(o.resDestinationPath),pdf:await raw(o.pdfDestinationPath),backup:await raw(o.backupPath)}};
 try{await checkHisSetting('his_outbound',value);outbound.saveCheck='PASS (write, read back, remove)';}catch(e){outbound.saveCheck='REFUSED: '+String(e?.message??e).slice(0,200);}
 result.outbound=outbound;
}
writeFileSync(resultFile,JSON.stringify(result,null,2));
