import {NextResponse,type NextRequest} from "next/server";
import {withTransaction} from "../../../../../packages/db/connection";
import {reportWorklist,reportCandidate,finalizeReports} from "../../../../../packages/readygen/reports";
import {protect,readJson} from "../../../../server/http";
import {noStore} from "../../../../server/p5";
import {task3Error,task3Mutation,reportDeps} from "../../../../server/task3";
/** LAB report worklist (GET ?q=&status=&page=), candidate detail and single/batch Final (POST). */
export async function GET(request:NextRequest){try{const user=await protect(request,"result.review"),q=request.nextUrl.searchParams;
 return NextResponse.json(await withTransaction(db=>reportWorklist(db,user,reportDeps(),{q:q.get("q")??"",status:q.get("status")??"ALL",page:Number(q.get("page")??1),pageSize:Number(q.get("pageSize")??50)})),{headers:noStore});}catch(e){return task3Error(e);}}
export async function POST(request:NextRequest){return task3Mutation(request,"TASK3_REPORT",async user=>{const {action,...data}=await readJson(request,262144);
 if(action==="candidate")return NextResponse.json(await withTransaction(db=>reportCandidate(db,user,reportDeps(),data)),{headers:noStore});
 if(action==="finalize")return NextResponse.json(await withTransaction(db=>finalizeReports(db,user,reportDeps(),data)),{headers:noStore});
 throw new Error("INVALID_REQUEST");});}
