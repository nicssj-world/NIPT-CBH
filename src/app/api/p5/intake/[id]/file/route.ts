import type {NextRequest} from "next/server";
import {withTransaction} from "../../../../../../../packages/db/connection";
import * as svc from "../../../../../../../packages/results/service";
import {protect} from "../../../../../../server/http";
import {p5Error,pdfResponse,resultStore} from "../../../../../../server/p5";
/** Preview of a quarantined PDF to the person who previewed it, before import. */
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{const user=await protect(request),{id}=await params;const r=await withTransaction(db=>svc.readIntakeFile(db,user,resultStore(),id));return pdfResponse(r.bytes,r.sha256,true,"synthetic-preview.pdf");}catch(e){return p5Error(e);}}
