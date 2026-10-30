import {NextResponse,type NextRequest} from 'next/server';
import {protect,readJson} from '../../../../server/http';
import {settingsError} from '../../../../server/settings-errors';
import {withTransaction} from '../../../../../packages/db/connection';
import {clearWorkerQueue} from '../../../../../packages/jobs/admin-clear';
import {retryFailedArchive} from '../../../../../packages/results/archive-settings';
import {z} from 'zod';
export async function POST(request:NextRequest){
 try{
  const user=await protect(request,'settings.read');
  if(!user.roles.includes('APP_ADMIN'))throw Error('FORBIDDEN');
  const input=await readJson(request);
  const result=await withTransaction(async db=>{
   if(typeof input==='object'&&input!==null&&(input as {action?:unknown}).action==='RETRY_SELECTED'){
    const selected=z.strictObject({action:z.literal('RETRY_SELECTED'),scope:z.literal('ARCHIVE'),ids:z.array(z.uuid()).min(1).max(75)}).parse(input);
    const retries=[];
    for(const id of selected.ids)retries.push(await retryFailedArchive(db,user,id));
    return {requested:retries.length,queuedProbes:retries};
   }
   return clearWorkerQueue(db,user,input);
  });
  return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(e){return settingsError(e);}
}
