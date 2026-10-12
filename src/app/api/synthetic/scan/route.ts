import {NextResponse,type NextRequest} from "next/server";
import {randomUUID} from "node:crypto";
import {protect,apiError} from "../../../../server/http";
import {withTransaction} from "../../../../../packages/db/connection";
import {appendAudit} from "../../../../../packages/db/audit";
export async function POST(request:NextRequest){try{const user=await protect(request,"his.scan",{},"write");const id=await withTransaction(async db=>{const r=await db.query<{id:string}>("INSERT INTO job_outbox(kind,payload,idempotency_key) VALUES('synthetic_scan',$2,$1) RETURNING id",["manual-scan:"+randomUUID(),JSON.stringify({trigger:"MANUAL",actorId:user.id})]);await appendAudit(db,{actorId:user.id,action:"MANUAL_SCAN_QUEUED",resourceType:"JOB",resourceId:r.rows[0].id,details:{synthetic:true}});return r.rows[0].id;});return NextResponse.json({id},{status:202});}catch(e){return apiError(e);}}
