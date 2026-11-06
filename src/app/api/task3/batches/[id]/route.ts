import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../../packages/db/connection';
import {readReportBatch} from '../../../../../../packages/readygen/batch-jobs';
import {protect} from '../../../../../server/http';
import {noStore} from '../../../../../server/p5';
import {task3Error} from '../../../../../server/task3';

export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{const user=await protect(request,'result.review'),{id}=await params;return NextResponse.json(await withTransaction(db=>readReportBatch(db,user,id)),{headers:noStore});}catch(error){return task3Error(error);}}
