import type {NextRequest} from 'next/server';
import {withTransaction} from '../../../../../../../packages/db/connection';
import {fallbackPackage} from '../../../../../../../packages/readygen/fallback-package';
import {protect} from '../../../../../../server/http';
import {workbookDeps} from '../../../../../../server/workbook';
import {task3Error,fileResponse} from '../../../../../../server/task3';
/** Task 3: offline ReadyGen fallback package of one frozen export pair (PHI — audited, encrypted media only per SOP). */
export async function GET(request:NextRequest,{params}:{params:Promise<{pairId:string}>}){
 try{const user=await protect(request),{pairId}=await params,deps=await workbookDeps();
  const out=await withTransaction(db=>fallbackPackage(db,user,pairId,deps));
  const res=fileResponse(out.bytes,'application/zip',out.filename);res.headers.set('X-Document-SHA256',out.sha256);return res;
 }catch(e){return task3Error(e);}
}
