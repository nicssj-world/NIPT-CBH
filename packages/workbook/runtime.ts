import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {inspectTaskMaster} from './master';
/** Single integrity-checked native master consumer; never falls back to a previous template. */
export async function loadRuntimeMaster(env:Record<string,string|undefined>=process.env){
 const configured=env.NIPT_TASK_MASTER_PATH;
 if(!configured)throw Error('TASK_MASTER_PATH_REQUIRED');
 if(configured.startsWith('\\\\')||configured.startsWith('//'))throw Error('TASK_MASTER_LOCAL_PATH_REQUIRED');
 let master:Buffer;try{master=await readFile(path.resolve(configured));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')throw Error('TASK_MASTER_FILE_NOT_FOUND');throw Error('TASK_MASTER_FILE_UNREADABLE');}
 inspectTaskMaster(master);return master;
}
