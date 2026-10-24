import type {NextRequest} from "next/server";
import {withTransaction} from "../../../../../../../packages/db/connection";
import {internalReportFile} from "../../../../../../../packages/readygen/reports";
import {protect} from "../../../../../../server/http";
import {resultStore} from "../../../../../../server/p5";
import {task3Error,fileResponse} from "../../../../../../server/task3";
/** LAB copy of a finalised internal report: the exact stored bytes, under its configured download name (access-logged). */
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{const user=await protect(request,"result.review"),{id}=await params;
 const r=await withTransaction(db=>internalReportFile(db,user,resultStore(),id));
 const res=fileResponse(r.bytes,"application/pdf",r.name,request.nextUrl.searchParams.get("download")!=="1");res.headers.set("X-Document-SHA256",r.sha256);return res;}catch(e){return task3Error(e);}}
