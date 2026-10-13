import type {NextRequest} from "next/server";
import {withTransaction} from "../../../../../../../../packages/db/connection";
import {readBatchPdf} from "../../../../../../../../packages/historical/service";
import {protect} from "../../../../../../../server/http";
import {p5hError} from "../../../../../../../server/p5h";
import {resultStore,pdfResponse} from "../../../../../../../server/p5";
/** Immutable original PDF for the reviewer; every read is audited. */
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string;fileId:string}>}){try{const user=await protect(request),{id,fileId}=await params;const r=await withTransaction(db=>readBatchPdf(db,user,resultStore(),id,fileId));return pdfResponse(r.bytes,r.sha256,true,"synthetic-historical.pdf");}catch(e){return p5hError(e);}}
