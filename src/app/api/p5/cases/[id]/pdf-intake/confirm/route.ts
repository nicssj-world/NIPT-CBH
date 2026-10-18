import {NextResponse,type NextRequest} from "next/server";
import {withTransaction} from "../../../../../../../../packages/db/connection";
import * as svc from "../../../../../../../../packages/results/service";
import {readJson} from "../../../../../../../server/http";
import {p5Mutation,noStore} from "../../../../../../../server/p5";
/** Confirms a checked case-page upload: same import, then P5-A link or a two-person proposal to the selected target. */
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){return p5Mutation(request,"P5_CASE_UPLOAD_CONFIRM",async user=>{
 const {id}=await params,input=await readJson(request);
 const target=input.target&&typeof input.target==="object"?{...(input.target as Record<string,unknown>),caseId:id}:input.target;
 return NextResponse.json(await withTransaction(db=>svc.caseUploadConfirm(db,user,{...input,target})),{headers:noStore});
});}
