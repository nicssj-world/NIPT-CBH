import type {NextRequest} from "next/server";
import {withTransaction} from "../../../../../../packages/db/connection";
import {previewReport} from "../../../../../../packages/readygen/reports";
import {readJson} from "../../../../../server/http";
import {task3Mutation,reportDeps,fileResponse} from "../../../../../server/task3";
/** Watermarked draft preview from the Owner master (never stored as a report). POST because it reads PHI and renders on the server. */
export async function POST(request:NextRequest){return task3Mutation(request,"TASK3_REPORT_PREVIEW",async user=>{const data=await readJson(request,16384);
 const r=await withTransaction(db=>previewReport(db,user,reportDeps(),data));
 const res=fileResponse(r.bytes,"application/pdf","preview.pdf",true);res.headers.set("X-Report-Holds",String(r.holds.length));return res;});}
