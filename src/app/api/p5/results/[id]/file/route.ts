import type {NextRequest} from "next/server";
import {withTransaction} from "../../../../../../../packages/db/connection";
import * as svc from "../../../../../../../packages/results/service";
import {protect} from "../../../../../../server/http";
import {p5Error,pdfResponse,resultStore} from "../../../../../../server/p5";
/** Immutable original for review; every read is access-logged. ZIP-as-PDF originals download instead of rendering. */
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{const user=await protect(request),{id}=await params;const r=await withTransaction(db=>svc.readVersionFile(db,user,resultStore(),id));return pdfResponse(r.bytes,r.sha256,r.pdf,r.pdf?"synthetic-result.pdf":"synthetic-result.zip");}catch(e){return p5Error(e);}}
