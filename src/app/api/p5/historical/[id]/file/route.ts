import type {NextRequest} from "next/server";
import {withTransaction} from "../../../../../../../packages/db/connection";
import * as svc from "../../../../../../../packages/results/service";
import {protect} from "../../../../../../server/http";
import {p5Error,namedPdfResponse,resultStore} from "../../../../../../server/p5";
/** PDF of a result already reported by the previous system (Genomic-CBH): scope-checked, no-store, access-logged; view, download or the print view of the same bytes. */
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{const user=await protect(request),{id}=await params;
 const m=request.nextUrl.searchParams.get("mode"),mode=m==="download"?"DOWNLOAD" as const:m==="print"?"PRINT" as const:"VIEW" as const;
 const r=await withTransaction(db=>svc.readHistoricalReportFile(db,user,resultStore(),id,mode));return namedPdfResponse(r.bytes,r.sha256,mode!=='DOWNLOAD',r.name);}catch(e){return p5Error(e);}}
