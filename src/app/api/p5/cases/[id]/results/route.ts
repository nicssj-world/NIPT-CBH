import {NextResponse,type NextRequest} from "next/server";
import {withTransaction} from "../../../../../../../packages/db/connection";
import * as svc from "../../../../../../../packages/results/service";
import {protect} from "../../../../../../server/http";
import {p5Error,noStore} from "../../../../../../server/p5";
/** ANC Result Viewer: only Released versions in scope; unreleased PDFs and notices are never returned. */
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{const user=await protect(request),{id}=await params;return NextResponse.json(await withTransaction(db=>svc.ancCaseResults(db,user,id)),{headers:noStore});}catch(e){return p5Error(e);}}
