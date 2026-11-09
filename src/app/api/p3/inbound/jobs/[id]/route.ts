import {NextResponse,type NextRequest} from "next/server";
import {z} from "zod";
import {protect} from "../../../../../../server/http";
import {p3Error,noStore} from "../../../../../../server/p3/inbound";
import {withTransaction} from "../../../../../../../packages/db/connection";

/**
 * Progress of one queued scan or connection test (Owner 2026-11-09: the buttons used to say "queued" and nothing more).
 * QUEUED = waiting for the worker, RUNNING = the worker took it, DONE = the worker stored its receipt. Only counters and the outcome word
 * are returned, never file names or patient data.
 */
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{
  await protect(request,"his.scan",{},"read");
  const id=z.uuid().parse((await params).id);
  const row=(await withTransaction(db=>db.query<{state:string;kind:string;result:Record<string,unknown>|null;completed_at:Date|null}>(
   `SELECT j.state,j.kind,r.result,r.completed_at FROM job_outbox j LEFT JOIN integration_job_receipt r ON r.outbox_id=j.id
    WHERE j.id=$1 AND j.kind IN ('synthetic_scan','synthetic_inbound_test')`,[id]))).rows[0];
  if(!row)return NextResponse.json({error:"ไม่พบงานนี้"},{status:404,headers:noStore});
  const state=row.completed_at?"DONE":row.state==="Cancelled"?"CANCELLED":row.state==="Dispatched"?"RUNNING":"QUEUED";
  const counts=row.result&&typeof row.result.counts==="object"&&row.result.counts?Object.fromEntries(Object.entries(row.result.counts as Record<string,unknown>).filter(([,v])=>typeof v==="number")):undefined;
  return NextResponse.json({state,kind:row.kind,...(row.completed_at?{result:{outcome:typeof row.result?.outcome==="string"?row.result.outcome:undefined,passed:typeof row.result?.passed==="boolean"?row.result.passed:undefined,counts}}:{})},{headers:noStore});
 }catch(e){return p3Error(e);}
}
