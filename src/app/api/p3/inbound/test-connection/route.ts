import {NextResponse,type NextRequest} from "next/server";
import {randomUUID} from "node:crypto";
import {protect} from "../../../../../server/http";
import {p3Error,noStore} from "../../../../../server/p3/inbound";
import {withTransaction} from "../../../../../../packages/db/connection";
import {appendAudit} from "../../../../../../packages/db/audit";
// Runs in the worker (simulator volume), read-only; the web only queues it.
export async function POST(request:NextRequest){try{const user=await protect(request,"integration.configure",{},"write");const id=await withTransaction(async db=>{const r=await db.query<{id:string}>("INSERT INTO job_outbox(kind,payload,idempotency_key) VALUES('synthetic_inbound_test','{}',$1) RETURNING id",["inbound-test:"+randomUUID()]);await appendAudit(db,{actorId:user.id,action:"INBOUND_TEST_CONNECTION_QUEUED",resourceType:"JOB",resourceId:r.rows[0].id,details:{synthetic:true}});return r.rows[0].id;});return NextResponse.json({id},{status:202,headers:noStore});}catch(e){return p3Error(e);}}
