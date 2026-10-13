import {NextResponse,type NextRequest} from "next/server";
import {withTransaction} from "../../../../../../packages/db/connection";
import * as svc from "../../../../../../packages/results/service";
import {protect} from "../../../../../server/http";
import {p5Error,noStore} from "../../../../../server/p5";
/** Polling endpoint for the requester's own Test Path / Scan / Preview job (the worker writes the receipt). */
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{const user=await protect(request),{id}=await params;return NextResponse.json(await withTransaction(db=>svc.resultJob(db,user,id)),{headers:noStore});}catch(e){return p5Error(e);}}
