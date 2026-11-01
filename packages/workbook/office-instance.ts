import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
const run=promisify(execFile);

/** After a native export failed or was stopped by its timeout: stop exactly the Office automation instance that export started.
 *  The export script records that instance's PID (native-export.ps1 / word-export.ps1, NIPT_OFFICE_PID_FILE). A PID is only
 *  stopped while it is still the expected executable, so a reused PID, a user's own Word/Excel or another export is never touched.
 *  Returns the stopped PID, or null when there was nothing (safe) to stop. */
export async function stopOwnOfficeInstance(pidFile:string,image:'WINWORD.EXE'|'EXCEL.EXE'):Promise<number|null>{
 let pid:number;
 try{pid=Number((await readFile(pidFile,'ascii')).trim());}catch{return null;}
 if(!Number.isInteger(pid)||pid<=0)return null;
 const system32=path.join(process.env.SystemRoot??'C:\\Windows','System32');
 try{
  const {stdout}=await run(path.join(system32,'tasklist.exe'),['/FI',`PID eq ${pid}`,'/FO','CSV','/NH'],{windowsHide:true});
  if(stdout.split(',')[0]?.replaceAll('"','').trim().toUpperCase()!==image)return null;
  await run(path.join(system32,'taskkill.exe'),['/PID',String(pid),'/F'],{windowsHide:true});
  return pid;
 }catch{return null;}
}
