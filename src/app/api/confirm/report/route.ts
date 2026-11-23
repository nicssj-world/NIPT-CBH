import {type NextRequest} from "next/server";
import {withTransaction} from "../../../../../packages/db/connection";
import {confirmReport} from "../../../../../packages/confirm/service";
import {protect} from "../../../../server/http";
import {resultStore} from "../../../../server/p5";
import {fileResponse} from "../../../../server/task3";
import {confirmError} from "../../../../server/confirm";

/** The outlab PDF of a case's confirm record (`sequence` = an earlier revision), shown inline. */
export async function GET(request:NextRequest){try{const user=await protect(request,"confirm.read");const p=request.nextUrl.searchParams,seq=p.get("sequence");
 const r=await withTransaction(db=>confirmReport(db,resultStore(),user,p.get("caseId")??"",seq?Number(seq):undefined));
 return fileResponse(r.bytes,"application/pdf",r.name,true);}catch(e){return confirmError(e);}}
