import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../../packages/db/connection';
import {benchWorkspace,benchPooling,benchExport} from '../../../../../../packages/lab/bench';
import {protect,readJson} from '../../../../../server/http';
import {noStore,p4Mutation} from '../../../../../server/p4';
import {workbookDeps,workbookError} from '../../../../../server/workbook';
import {recordActualPooling,exportSeqPair} from '../../../../../../packages/lab/seq-export';
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{const user=await protect(request),{id}=await params,deps=await workbookDeps();return NextResponse.json(await withTransaction(db=>benchWorkspace(db,user,id,deps)),{headers:noStore});}catch(e){return workbookError(e);}
}
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 return p4Mutation(request,'LAB_BENCH',async user=>{
  const {id}=await params,{action,...data}=await readJson(request,65536),deps=await workbookDeps();
  try{
   if(action==='pool')return NextResponse.json(await withTransaction(db=>benchPooling(db,user,id,deps)),{headers:noStore});
   if(action==='recordActualPooling')return NextResponse.json(await withTransaction(db=>recordActualPooling(db,user,{...data,batchId:id},deps)),{headers:noStore});
   if(action==='exportSeqPair')return NextResponse.json(await withTransaction(db=>exportSeqPair(db,user,{...data,batchId:id},deps)),{headers:noStore});
   if(action==='export'){
    const out=await withTransaction(db=>benchExport(db,user,{...data,batchId:id},deps));
    return new NextResponse(new Uint8Array(out.bytes),{headers:{...noStore,'Content-Type':out.kind==='POOL_CSV'?'text/csv; charset=utf-8':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${out.kind==='POOL_CSV'?'Pooling':'NIFTY'}-${out.id}.${out.kind==='POOL_CSV'?'csv':'xlsx'}"`,'X-Document-SHA256':out.sha256}});
   }
   throw Error('ACTION_NOT_ALLOWED');
  }catch(e){return workbookError(e);}
 });
}
