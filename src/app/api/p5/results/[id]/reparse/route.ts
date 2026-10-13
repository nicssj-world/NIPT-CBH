import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../../../packages/db/connection';
import {reparseResult,reparseHistory} from '../../../../../../../packages/results/reparse';
import {readJson,protect} from '../../../../../../server/http';
import {p5Mutation,p5Error,noStore,resultStore} from '../../../../../../server/p5';
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{const user=await protect(request),{id}=await params;return NextResponse.json({evidence:await withTransaction(db=>reparseHistory(db,user,id))},{headers:noStore});}catch(e){return p5Error(e);}}
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 return p5Mutation(request,'P7_REPARSE',async user=>{const {id}=await params,data=await readJson(request);
  return NextResponse.json(await withTransaction(db=>reparseResult(db,user,resultStore(),{...data,versionId:id})),{headers:noStore});
 });
}
