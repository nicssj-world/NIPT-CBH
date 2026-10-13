import {NextResponse,type NextRequest} from "next/server";
import {withTransaction} from "../../../../../packages/db/connection";
import * as svc from "../../../../../packages/results/service";
import {publicResultQuery} from "../../../../../packages/results/query";
import {protect,readJson} from "../../../../server/http";
import {p5Error,p5Mutation,noStore,intakeContext} from "../../../../server/p5";
/** Lab result workspace: intake context (folder, last Test Path / Scan) and the review queue. */
export async function GET(request:NextRequest){try{const user=await protect(request,"result.review");return NextResponse.json(await withTransaction(async db=>({...await svc.resultQueue(db,user,publicResultQuery(request.nextUrl.searchParams)),intake:await intakeContext(db,user)})),{headers:noStore});}catch(e){return p5Error(e);}}
export async function POST(request:NextRequest){return p5Mutation(request,"P5_INTAKE",async user=>{publicResultQuery(request.nextUrl.searchParams);const {action,...data}=await readJson(request,65536);
 const r=await withTransaction(async db=>{
  if(action==="query")return {...await svc.resultQueue(db,user,data),intake:await intakeContext(db,user)};
  if(action==="testPath")return {jobId:await svc.queueResultJob(db,user,"synthetic_result_test_path")};
  if(action==="scan")return {jobId:await svc.queueResultJob(db,user,"synthetic_result_scan")};
  if(action==="preview")return {jobId:await svc.queueResultJob(db,user,"synthetic_result_preview",data)};
  if(action==="confirm")return {results:await svc.confirmImport(db,user,data)};
  throw new Error("INVALID_REQUEST");});
 return NextResponse.json(r,{status:action==="confirm"||action==="query"?200:202,headers:noStore});});}
