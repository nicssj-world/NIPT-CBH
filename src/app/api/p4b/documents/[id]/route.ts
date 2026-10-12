import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../../packages/db/connection';
import {readF4,printF4} from '../../../../../../packages/pooling/documents';
import {protect,readJson} from '../../../../../server/http';
import {p4Error,p4Mutation,noStore} from '../../../../../server/p4';
import {f4Deps} from '../../../../../server/p4b';
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{const user=await protect(request),{id}=await params;const result=await withTransaction(db=>readF4(db,user,id,f4Deps()));return new NextResponse(new Uint8Array(result.bytes),{headers:{...noStore,'Content-Type':'application/pdf','Content-Disposition':'inline; filename="synthetic-f4.pdf"','X-Document-Status':result.status,'X-Document-SHA256':result.sha256}});}catch(e){return p4Error(e);}
}
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 return p4Mutation(request,'P4B_PRINT',async user=>{const {id}=await params,data=await readJson(request);const result=await withTransaction(db=>printF4(db,user,{...data,documentId:id},f4Deps()));return new NextResponse(new Uint8Array(result.bytes),{headers:{...noStore,'Content-Type':'application/pdf','X-Copy-ID':result.id,'X-Document-SHA256':result.sha256}});});
}
