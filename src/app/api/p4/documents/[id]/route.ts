import {NextResponse,type NextRequest} from "next/server";
import {withTransaction} from "../../../../../../packages/db/connection";
import * as rec from "../../../../../../packages/lab/records";
import {protect,readJson} from "../../../../../server/http";
import {p4Error,p4Mutation,labDeps} from "../../../../../server/p4";
const pdf=(bytes:Buffer,name:string,sha:string,status:string,copyId?:string)=>new NextResponse(new Uint8Array(bytes),{headers:{"Content-Type":"application/pdf","Content-Disposition":`inline; filename="${name.replace(/[^A-Za-z0-9._-]/g,"_")}"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","X-Document-SHA256":sha,"X-Document-Status":status,...(copyId?{"X-Copy-ID":copyId}:{})}});
/** Viewer: the Issued original bytes; its current status is shown by the page around it, never written into the file. */
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{const user=await protect(request),{id}=await params;const r=await withTransaction(db=>rec.readOriginal(db,user,id,labDeps()));return pdf(r.bytes,r.fileName,r.sha256,r.status);}catch(e){return p4Error(e);}}
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){return p4Mutation(request,"P4_DOCUMENT_PRINT",async user=>{const {id}=await params;const input={...await readJson(request),documentId:id};const r=await withTransaction(db=>rec.printDocument(db,user,input,labDeps()));return pdf(r.bytes,r.fileName,r.sha256,r.status,r.copyId);});}
