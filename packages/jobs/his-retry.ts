import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {loadTransfer} from '../p6/journal';
import {runTransfer} from '../p6/worker';
export async function executeHisRetry(db:Queryable,payload:unknown){
 const p=z.strictObject({transferId:z.uuid(),revision:z.number().int().nonnegative()}).parse(payload),row=await loadTransfer(db,p.transferId);
 if(row.revision!==p.revision)return {state:'SKIPPED_STALE_RETRY'};
 if(row.model.state!=='RETRY_PENDING')throw Error('HIS_RETRY_NOT_ALLOWED');
 return {state:await runTransfer(db,row.id),hisConfirmed:false};
}
