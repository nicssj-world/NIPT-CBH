import {NextResponse,type NextRequest} from "next/server";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {protect,readJson} from "../../../../../server/http";
import {p3Error,noStore} from "../../../../../server/p3/inbound";
import {withTransaction} from "../../../../../../packages/db/connection";
import {appendAudit} from "../../../../../../packages/db/audit";
// Plan §10.2 ข้อ 1: Deep scan beyond the normal lookback, always audited.
export async function POST(request:NextRequest){try{const user=await protect(request,"his.scan",{},"write");const {lookbackDays}=z.strictObject({lookbackDays:z.number().int().min(1).max(90)}).parse(await readJson(request));const id=await withTransaction(async db=>{const r=await db.query<{id:string}>("INSERT INTO job_outbox(kind,payload,idempotency_key) VALUES('synthetic_scan',$2,$1) RETURNING id",["deep-scan:"+randomUUID(),JSON.stringify({trigger:"DEEP",lookbackDays,actorId:user.id})]);await appendAudit(db,{actorId:user.id,action:"INBOUND_DEEP_SCAN_QUEUED",resourceType:"JOB",resourceId:r.rows[0].id,details:{count:lookbackDays,synthetic:true}});return r.rows[0].id;});return NextResponse.json({id},{status:202,headers:noStore});}catch(e){return p3Error(e);}}
