import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../packages/db/connection';
import {readEqaRegistry,readIqc} from '../../../../../packages/eqa/registry';
import {protect} from '../../../../server/http';
import {p2Error,noStore} from '../../../../server/p2/http';
/** ?view=iqc returns the PC/NC control table, otherwise the EQA registry. Read-only; access follows result review. */
export async function GET(request:NextRequest){
 try{
  const user=await protect(request,'result.review');
  const {view,...query}=Object.fromEntries(request.nextUrl.searchParams);
  const body:unknown=await withTransaction(async db=>view==='iqc'?await readIqc(db,user,query):await readEqaRegistry(db,user,query));
  return NextResponse.json(body,{headers:noStore});
 }catch(e){return p2Error(e);}
}
