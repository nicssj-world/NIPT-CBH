import {NextResponse,type NextRequest} from "next/server";
import {withTransaction} from "../../../../../../packages/db/connection";
import {readHalosImport,decideHalosImport} from "../../../../../../packages/readygen/halos-import";
import {protect,readJson} from "../../../../../server/http";
import {noStore} from "../../../../../server/p5";
import {task3Error,task3Mutation} from "../../../../../server/task3";
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{const user=await protect(request,"result.review"),{id}=await params;return NextResponse.json(await withTransaction(db=>readHalosImport(db,user,id)),{headers:noStore});}catch(e){return task3Error(e);}}
/** Confirm or cancel the previewed import (warnings need explicit acknowledgement). */
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){return task3Mutation(request,"TASK3_HALOS_DECIDE",async user=>{const {id}=await params,data=await readJson(request);
 return NextResponse.json(await withTransaction(db=>decideHalosImport(db,user,{...data,importId:id})),{headers:noStore});});}
