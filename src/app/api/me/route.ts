import {NextResponse,type NextRequest} from "next/server";
import {protect,apiError,CSRF_COOKIE} from "../../../server/http";
import {pool} from "../../../../packages/db/connection";
export async function GET(request:NextRequest){try{const user=await protect(request);const profile=(await pool().query<{display_name:string;phone:string}>('SELECT display_name,phone FROM app_user WHERE id=$1 AND enabled',[user.id])).rows[0];return NextResponse.json({id:user.id,roles:user.roles,csrf:request.cookies.get(CSRF_COOKIE)?.value,displayName:profile?.display_name??"",phone:profile?.phone??""},{headers:{"Cache-Control":"no-store"}});}catch(e){return apiError(e);}}
