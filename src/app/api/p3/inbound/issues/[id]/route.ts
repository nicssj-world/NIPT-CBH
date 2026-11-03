import {NextResponse,type NextRequest} from "next/server";
import {protect,readJson} from "../../../../../../server/http";
import {p3Error,noStore,inboundDeps} from "../../../../../../server/p3/inbound";
import {withTransaction} from "../../../../../../../packages/db/connection";
import {proposeResolution,decideResolution,resolveIssueDirect} from "../../../../../../../packages/inbound/resolution";
// Legacy two-person operations remain readable and enforce their historical rules. Owner-approved direct resolution has a separate guarded operation.
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{
  const user=await protect(request);const {id}=await params;const {op,...input}=await readJson(request);
  if(op==="resolve"){const deps=await inboundDeps();try{return NextResponse.json(await withTransaction(db=>resolveIssueDirect(db,user,id,input,deps)),{headers:noStore});}finally{deps.lookupKey.fill(0);}}
  if(op==="propose")return NextResponse.json(await withTransaction(db=>proposeResolution(db,user,id,input)),{headers:noStore});
  if(op==="decide"){const deps=await inboundDeps();try{return NextResponse.json(await withTransaction(db=>decideResolution(db,user,id,input,deps)),{headers:noStore});}finally{deps.lookupKey.fill(0);}}
  return NextResponse.json({code:"UNKNOWN_OPERATION",error:"ไม่รู้จักคำสั่งนี้"},{status:400,headers:noStore});
 }catch(e){return p3Error(e);}
}
