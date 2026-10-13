import type {NextRequest} from "next/server";
import {withTransaction} from "../../../../../../../packages/db/connection";
import * as svc from "../../../../../../../packages/results/service";
import {protect} from "../../../../../../server/http";
import {p5Error,pdfResponse,resultStore} from "../../../../../../server/p5";
/** Released PDF for ANC (scope-checked, no-store, access-logged). No release can exist until AL-5, so this answers 404 today. */
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{const user=await protect(request),{id}=await params;const r=await withTransaction(db=>svc.readReleasedFile(db,user,resultStore(),id));return pdfResponse(r.bytes,r.sha256,true,"nipt-result.pdf");}catch(e){return p5Error(e);}}
