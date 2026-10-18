import {NextResponse,type NextRequest} from "next/server";
import {withTransaction} from "../../../../../../packages/db/connection";
import {runGallery} from "../../../../../../packages/run-photos/service";
import {protect} from "../../../../../server/http";
import {photoError,noStore} from "../../../../../server/run-photos";
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{const user=await protect(request),{id}=await params;
 return NextResponse.json(await withTransaction(db=>runGallery(db,user,id,{includeRetracted:request.nextUrl.searchParams.get("retracted")==="1"})),{headers:noStore});}catch(e){return photoError(e);}}
