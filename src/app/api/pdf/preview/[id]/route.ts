import {NextResponse,type NextRequest} from "next/server";
import path from "node:path";
import {protect,apiError} from "../../../../../server/http";
import {pool,withTransaction} from "../../../../../../packages/db/connection";
import {appendAudit} from "../../../../../../packages/db/audit";
import {FileStore} from "../../../../../../packages/storage";
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{const user=await protect(request,"health.read");const {id}=await params;if(!/^[a-f0-9-]{36}$/.test(id))throw new Error("FORBIDDEN");const row=await pool().query<{asset_hash:string}>("SELECT asset_hash FROM pdf_preview_cache WHERE id=$1 AND session_id=$2 AND expires_at>now()",[id,user.sessionId]);if(!row.rows[0])throw new Error("FORBIDDEN");const bytes=await new FileStore(path.resolve(process.env.FILE_STORE_ROOT??"data/files")).get(row.rows[0].asset_hash);await withTransaction(db=>appendAudit(db,{actorId:user.id,action:"PDF_PREVIEW_READ",resourceType:"PREVIEW",resourceId:id,details:{synthetic:true}}));return new NextResponse(new Uint8Array(bytes),{headers:{"Content-Type":"application/pdf","Content-Disposition":"inline; filename=synthetic-foundation.pdf","Cache-Control":"private, no-store"}});}catch(e){return apiError(e);}}
