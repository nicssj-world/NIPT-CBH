import type {NextRequest} from "next/server";
import {withTransaction} from "../../../../../../../packages/db/connection";
import {batchZip} from "../../../../../../../packages/readygen/reports";
import {protect} from "../../../../../../server/http";
import {resultStore} from "../../../../../../server/p5";
import {task3Error,fileResponse} from "../../../../../../server/task3";
/** One PDF per patient of a Final batch, with a manifest that also lists held/failed rows. */
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{const user=await protect(request,"result.review"),{id}=await params;
 const r=await withTransaction(db=>batchZip(db,user,resultStore(),id));return fileResponse(r.bytes,"application/zip",r.filename);}catch(e){return task3Error(e);}}
