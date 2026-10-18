import {NextResponse,type NextRequest} from "next/server";
import {z} from "zod";
import {withTransaction} from "../../../../../../packages/db/connection";
import {getBatch,fixRow,abandonRow,recheckBatch,confirmBatch} from "../../../../../../packages/historical/service";
import {protect,readJson} from "../../../../../server/http";
import {p5hError,p5hMutation,noStore,identityLookupKey} from "../../../../../server/p5h";
import {resultStore} from "../../../../../server/p5";
/** Step 2 + 3 data: staged rows with their findings (polled until the worker has finished). */
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{const user=await protect(request,"history.read",{},"read"),{id}=await params;return NextResponse.json(await withTransaction(db=>getBatch(db,user,id,Object.fromEntries(request.nextUrl.searchParams))),{headers:noStore});}catch(e){return p5hError(e);}}
const fixBody=z.strictObject({action:z.literal("fix"),draftId:z.uuid(),patch:z.record(z.string(),z.string()),reason:z.string()});
const abandonBody=z.strictObject({action:z.literal("abandon"),draftId:z.uuid(),reason:z.string()});
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){return p5hMutation(request,"P5H_BATCH",async user=>{
 const {id}=await params;const body=await readJson(request,1_000_000);
 const out=await withTransaction(async db=>{
  switch(body.action){
   case "fix":{const b=fixBody.parse(body);return fixRow(db,user,resultStore(),b.draftId,b.patch,b.reason);}
   case "abandon":{const b=abandonBody.parse(body);return abandonRow(db,user,b.draftId,b.reason);}
   case "recheck":return recheckBatch(db,user,id);
   case "confirm":{const {action,...rest}=body;void action;return confirmBatch(db,user,id,await identityLookupKey(),rest);}
   default:throw new Error("INVALID_REQUEST");}
 });
 return NextResponse.json(out,{headers:noStore});});}
