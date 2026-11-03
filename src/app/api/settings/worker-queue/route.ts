import {NextResponse,type NextRequest} from 'next/server';
import {protect,readJson} from '../../../../server/http';
import {settingsError} from '../../../../server/settings-errors';
import {withTransaction} from '../../../../../packages/db/connection';
import {requestWorkerQueueClear} from '../../../../../packages/jobs/queue-clear';
import {requestWorkerQueueRetry} from '../../../../../packages/jobs/queue-retry';
import {retryFailedArchive} from '../../../../../packages/results/archive-settings';
import {requestHisRetry} from '../../../../../packages/settings/his-monitoring';
import {z} from 'zod';
const retrySchema=z.strictObject({action:z.literal('RETRY_SELECTED'),scope:z.enum(['OUTBOX','ARCHIVE','HIS_TRANSFER']),ids:z.array(z.uuid()).min(1).max(75)});
/** Clear and retry are requests only. Archive retry asks the Worker to probe the NAS first; HIS transfer retry keeps its own guard
 *  (only RETRY_PENDING; an unknown or unconfirmed transmission is never retried from here). */
export async function POST(request:NextRequest){
 try{
  const user=await protect(request,'settings.read');
  if(!user.roles.includes('APP_ADMIN'))throw Error('FORBIDDEN');
  const input=await readJson(request);
  const result=await withTransaction(async db=>{
   if(typeof input==='object'&&input!==null&&(input as {action?:unknown}).action==='RETRY_SELECTED'){
    const selected=retrySchema.parse(input);
    if(selected.scope==='OUTBOX')return requestWorkerQueueRetry(db,user,{scope:'OUTBOX',ids:selected.ids});
    if(selected.scope==='HIS_TRANSFER'){for(const id of selected.ids)await requestHisRetry(db,user,id);return {requested:selected.ids.length,alreadyRequested:0,unknown:0};}
    for(const id of selected.ids)await retryFailedArchive(db,user,id);
    return {requested:selected.ids.length,alreadyRequested:0,unknown:0};
   }
   return requestWorkerQueueClear(db,user,input);
  });
  return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(e){return settingsError(e);}
}
