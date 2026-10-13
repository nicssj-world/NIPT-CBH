import {NextResponse,type NextRequest} from "next/server";
import {withTransaction} from "../../../../../packages/db/connection";
import {createBatch,listBatches,loadContext,contextReady,BATCH_LIMITS} from "../../../../../packages/historical/service";
import {protect} from "../../../../server/http";
import {p5hError,p5hMutation,noStore} from "../../../../server/p5h";
import {resultStore} from "../../../../server/p5";
/** Step 1: list batches / upload the table with the PDF or ZIP files. The worker (not this request) reads and checks them. */
export async function GET(request:NextRequest){try{const user=await protect(request,"history.read",{},"read");
 return NextResponse.json(await withTransaction(async db=>{const ctx=await loadContext(db);return {batches:await listBatches(db,user),ready:contextReady(ctx),maxRows:ctx.maxRows,limits:{files:BATCH_LIMITS.files}};}),{headers:noStore});}catch(e){return p5hError(e);}}
export async function POST(request:NextRequest){return p5hMutation(request,"P5H_UPLOAD",async user=>{
 if(Number(request.headers.get("content-length")??0)>BATCH_LIMITS.totalBytes+1_000_000)throw new Error("UPLOAD_TOO_LARGE");
 const form=await request.formData();
 const table=form.get("table");if(!table||typeof table==="string")throw new Error("TABLE_EMPTY");
 const files=form.getAll("files").filter((x):x is File=>typeof x!=="string");
 const key=form.get("idempotencyKey");
 const read=async(f:File)=>({name:f.name,bytes:Buffer.from(await f.arrayBuffer())});
 const r=await withTransaction(async db=>createBatch(db,user,resultStore(),{table:await read(table),files:await Promise.all(files.map(read)),idempotencyKey:typeof key==="string"&&key?key:undefined}));
 return NextResponse.json(r,{status:202,headers:noStore});});}
