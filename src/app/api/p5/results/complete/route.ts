import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../../packages/db/connection';
import {previewCompletion,confirmCompletion} from '../../../../../../packages/results/completion';
import {readJson} from '../../../../../server/http';
import {noStore,p5Mutation} from '../../../../../server/p5';

export async function POST(request:NextRequest){return p5Mutation(request,'P5_RESULT_COMPLETION',async user=>{
 const {action,...data}=await readJson(request,65536);
 const result=await withTransaction<unknown>(db=>action==='preview'?previewCompletion(db,user,data):action==='confirm'?confirmCompletion(db,user,data):Promise.reject(new Error('INVALID_REQUEST')));
 return NextResponse.json(result,{headers:noStore});
});}
