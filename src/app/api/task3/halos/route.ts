import {NextResponse,type NextRequest} from "next/server";
import {withTransaction} from "../../../../../packages/db/connection";
import {previewHalosImport,listHalosImports,HALOS_MAX_BYTES} from "../../../../../packages/readygen/halos-import";
import {protect} from "../../../../server/http";
import {noStore,resultStore} from "../../../../server/p5";
import {task3Error,task3Mutation,uploadedFile} from "../../../../server/task3";
/** HALOS "Sample analysis data" imports: list (GET) and upload + read-only preview (POST multipart field "file"). */
export async function GET(request:NextRequest){try{const user=await protect(request,"result.review");return NextResponse.json({imports:await withTransaction(db=>listHalosImports(db,user))},{headers:noStore});}catch(e){return task3Error(e);}}
export async function POST(request:NextRequest){return task3Mutation(request,"TASK3_HALOS_PREVIEW",async user=>{
 const f=await uploadedFile(request,"file",HALOS_MAX_BYTES);
 return NextResponse.json(await withTransaction(db=>previewHalosImport(db,user,resultStore(),{name:f.name,bytes:f.bytes})),{headers:noStore});});}
