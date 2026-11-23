import {NextResponse,type NextRequest} from "next/server";
import {withTransaction} from "../../../../packages/db/connection";
import {confirmBoard,confirmDetail} from "../../../../packages/confirm/service";
import {confirmStats} from "../../../../packages/confirm/stats";
import {protect,readJson} from "../../../server/http";
import {noStore} from "../../../server/p5";
import {confirmError} from "../../../server/confirm";

/** ผลตรวจยืนยัน: `?caseId=` = one case for the editor; `?view=stats&fy=` = the concordance figures (counts only). */
export async function GET(request:NextRequest){try{const user=await protect(request,"confirm.read");const p=request.nextUrl.searchParams,caseId=p.get("caseId");
 const r=await withTransaction<unknown>(async db=>{await db.query("SET TRANSACTION READ ONLY");
  return caseId?confirmDetail(db,user,caseId):confirmStats(db,user,p.get("fy")?{fy:p.get("fy")}:{});});
 return NextResponse.json(r,{headers:noStore});}catch(e){return confirmError(e);}}

/** The list is a POST so a searched LN/HN never appears in a URL. It records PHI access, so it is not read-only. */
export async function POST(request:NextRequest){try{const user=await protect(request,"confirm.read");const {action,...data}=await readJson(request,4096);
 if(action!=="board")throw new Error("INVALID_REQUEST");
 return NextResponse.json(await withTransaction(db=>confirmBoard(db,user,data)),{headers:noStore});}catch(e){return confirmError(e);}}
