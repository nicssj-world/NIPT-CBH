import {NextResponse,type NextRequest} from "next/server";
import {z} from "zod";
import {protect,readJson} from "../../../../../../server/http";
import {p3Error,noStore} from "../../../../../../server/p3/inbound";
import {withTransaction} from "../../../../../../../packages/db/connection";
import {reviewParseError} from "../../../../../../../packages/inbound/file-review";

const input=z.strictObject({action:z.enum(['delete','restore'])});

export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{
  const user=await protect(request,'his.scan',{},'write'),{id}=await params,body=input.parse(await readJson(request));
  const result=await withTransaction(db=>reviewParseError(db,user,id,body.action));
  return NextResponse.json(result,{headers:noStore});
 }catch(error){return p3Error(error);}
}
