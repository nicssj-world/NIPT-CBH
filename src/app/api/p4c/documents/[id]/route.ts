import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../../packages/db/connection';
import {readF5,printF5} from '../../../../../../packages/sequencing/documents';
import {protect,readJson} from '../../../../../server/http';
import {p4Error,p4Mutation,noStore} from '../../../../../server/p4';
import {f5Deps} from '../../../../../server/p4c';
const response=(r:{bytes:Buffer;sha256:string;status?:string})=>new NextResponse(new Uint8Array(r.bytes),{headers:{...noStore,'Content-Type':'application/pdf','Content-Disposition':'inline; filename="F5-simulation.pdf"','X-Content-SHA256':r.sha256,'X-Document-Status':r.status??'SYNTHETIC_HOLD'}});
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{const user=await protect(request),{id}=await params;return response(await withTransaction(db=>readF5(db,user,id,f5Deps())));}catch(e){return p4Error(e);}}
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){return p4Mutation(request,'F5_PRINT',async user=>{const {id}=await params,input={...await readJson(request),documentId:id};return response(await withTransaction(db=>printF5(db,user,input,f5Deps())));});}
