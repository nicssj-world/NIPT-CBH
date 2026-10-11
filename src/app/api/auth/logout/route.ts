import {NextResponse,type NextRequest} from "next/server";
import {withTransaction} from "../../../../../packages/db/connection";
import {appendAudit} from "../../../../../packages/db/audit";
import {revokeSession} from "../../../../../packages/security/session";
import {apiError,protect,SESSION_COOKIE,CSRF_COOKIE} from "../../../../server/http";
export async function POST(request:NextRequest){try{const user=await protect(request);await withTransaction(async db=>{await revokeSession(db,request.cookies.get(SESSION_COOKIE)?.value??"");await appendAudit(db,{actorId:user.id,action:"AUTH_LOGOUT",resourceType:"SESSION"});});const r=NextResponse.json({ok:true});r.cookies.delete(SESSION_COOKIE);r.cookies.delete(CSRF_COOKIE);return r;}catch(e){return apiError(e);}}
