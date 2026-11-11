import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../../packages/db/connection';
import {readReportBatch} from '../../../../../../packages/readygen/batch-jobs';
import {protect} from '../../../../../server/http';
import {noStore} from '../../../../../server/p5';
import {task3Error,failureMessage} from '../../../../../server/task3';

export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{const user=await protect(request,'result.review'),{id}=await params;const batch=await withTransaction(db=>readReportBatch(db,user,id));return NextResponse.json({...batch,items:batch.items.map(i=>{const code=(i.outcome as {code?:string}|null|undefined)?.code,text=code?failureMessage(code):undefined;return text?{...i,outcome:{...(i.outcome as object),text}}:i;})},{headers:noStore});}catch(error){return task3Error(error);}}
