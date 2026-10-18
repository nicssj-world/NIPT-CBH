import {NextResponse,type NextRequest} from "next/server";
import {withTransaction} from "../../../../../packages/db/connection";
import {searchRunPhotos} from "../../../../../packages/run-photos/service";
import {readJson} from "../../../../server/http";
import {photoMutation,noStore} from "../../../../server/run-photos";
// POST so that LN values never appear in a URL, browser history or access logs.
export async function POST(request:NextRequest){return photoMutation(request,"RUN_PHOTO_SEARCH",async user=>{const input=await readJson(request);return NextResponse.json(await withTransaction(db=>searchRunPhotos(db,user,input)),{headers:noStore});});}
