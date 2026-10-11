import {NextResponse} from "next/server";
import {token} from "../../../../../packages/security/session";
import {assertSynthetic} from "../../../../../packages/security/runtime";
import {cookieOptions,CSRF_COOKIE,currentUser} from "../../../../server/http";
export async function GET(){
 assertSynthetic();
 const user=await currentUser();
 // Pre-login token. Existing session-bound CSRF is returned through /api/me instead.
 if(user) return NextResponse.json({error:"ALREADY_AUTHENTICATED"},{status:409});
 const csrf=token(),response=NextResponse.json({csrf});response.cookies.set(CSRF_COOKIE,csrf,{...cookieOptions(),maxAge:600});return response;
}
