import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../packages/db/connection';
import {enqueueReportBatch,listReportBatches} from '../../../../../packages/readygen/batch-jobs';
import {protect,readJson} from '../../../../server/http';
import {noStore} from '../../../../server/p5';
import {task3Error,task3Mutation} from '../../../../server/task3';

export async function GET(request:NextRequest){try{const user=await protect(request,'result.review');return NextResponse.json(await withTransaction(db=>listReportBatches(db,user)),{headers:noStore});}catch(error){return task3Error(error);}}
export async function POST(request:NextRequest){return task3Mutation(request,'TASK3_BATCH',async user=>{const input=await readJson(request,262144);return NextResponse.json(await withTransaction(db=>enqueueReportBatch(db,user,input)),{status:202,headers:noStore});});}
