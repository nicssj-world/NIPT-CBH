import type {NextRequest} from "next/server";
import {withTransaction} from "../../../../../../../packages/db/connection";
import {readHalosSource} from "../../../../../../../packages/readygen/halos-import";
import {protect} from "../../../../../../server/http";
import {resultStore} from "../../../../../../server/p5";
import {task3Error,fileResponse} from "../../../../../../server/task3";
/** The archived original HALOS workbook, byte-for-byte, for authorised LAB readers (audited). */
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{const user=await protect(request,"result.review"),{id}=await params;
 const r=await withTransaction(db=>readHalosSource(db,user,resultStore(),id));
 const res=fileResponse(r.bytes,"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",r.name);res.headers.set("X-Document-SHA256",r.sha256);return res;}catch(e){return task3Error(e);}}
