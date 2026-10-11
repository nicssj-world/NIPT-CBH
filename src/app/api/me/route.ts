import {NextResponse,type NextRequest} from "next/server";
import {protect,apiError,CSRF_COOKIE} from "../../../server/http";
export async function GET(request:NextRequest){try{const user=await protect(request);return NextResponse.json({id:user.id,roles:user.roles,csrf:request.cookies.get(CSRF_COOKIE)?.value});}catch(e){return apiError(e);}}
