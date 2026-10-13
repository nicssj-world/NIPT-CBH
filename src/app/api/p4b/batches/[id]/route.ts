import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../../packages/db/connection';
import * as pool from '../../../../../../packages/pooling/service';
import * as docs from '../../../../../../packages/pooling/documents';
import {protect,readJson} from '../../../../../server/http';
import {p4Error,p4Mutation,noStore} from '../../../../../server/p4';
import {f4Deps} from '../../../../../server/p4b';
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{const user=await protect(request),{id}=await params;return NextResponse.json(await withTransaction(db=>pool.workspace(db,user,id)),{headers:noStore});}catch(e){return p4Error(e);}
}
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 return p4Mutation(request,'P4B_POOL',async user=>{
  const {id}=await params,{action,...data}=await readJson(request,65536),input={...data,batchId:id};
  if(action==='previewSynthetic'){
   const r=await withTransaction(db=>docs.issueSyntheticDocument(db,user,input,f4Deps(),true));
   if(!r.bytes)throw Error('PREVIEW_FAILED');
   return new NextResponse(new Uint8Array(r.bytes),{headers:{...noStore,'Content-Type':'application/pdf'}});
  }
  return NextResponse.json(await withTransaction(async db=>{
   switch(action){case 'create':return pool.createPool(db,user,input);case 'crosscheck':return pool.crosscheck(db,user,input);
    case 'transition':return pool.transition(db,user,input);case 'record':return pool.recordPoolObservation(db,user,input);
    case 'review':return pool.reviewPoolObservation(db,user,input);case 'decideQc2':return pool.decideQc2(db,user,input);
    case 'issueSynthetic':return docs.issueSyntheticDocument(db,user,input,f4Deps());case 'recall':return docs.recallF4(db,user,input);
    case 'issueOperational':case 'accept':case 'export':return pool.operationalGate(db,user,input);
    default:throw Error('ACTION_NOT_ALLOWED');}
  }),{headers:noStore});
 });
}
