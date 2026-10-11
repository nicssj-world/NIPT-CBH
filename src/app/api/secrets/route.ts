import {NextResponse,type NextRequest} from "next/server";
import {readFile} from "node:fs/promises";
import {protect,apiError,readJson} from "../../../server/http";
import {withTransaction} from "../../../../packages/db/connection";
import {appendAudit} from "../../../../packages/db/audit";
import {sealSecret} from "../../../../packages/security/envelope";
export async function POST(request:NextRequest){try{const user=await protect(request,"secret.write",{},"write");const input=await readJson(request);if(!["his_inbound","his_outbound","backup"].includes(String(input.key))||typeof input.value!=="string")throw new Error("INVALID_SECRET");const publicKey=await readFile(process.env.INTEGRATION_PUBLIC_KEY_FILE??"","utf8"),e=sealSecret(input.value,publicKey,"integration-v1",String(input.key));await withTransaction(async db=>{const r=await db.query<{id:string}>("INSERT INTO secret_revision(secret_key,key_version,wrapped_key,iv,tag,ciphertext,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",[input.key,e.keyVersion,e.wrappedKey,e.iv,e.tag,e.ciphertext,user.id]);await appendAudit(db,{actorId:user.id,action:"SECRET_WRITTEN",resourceType:"SECRET",resourceId:r.rows[0].id,details:{outcome:"PENDING_TEST",synthetic:true}});});return NextResponse.json({configured:true,status:"PENDING_TEST"},{status:201});}catch(e){return apiError(e);}}
