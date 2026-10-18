import {NextResponse,type NextRequest} from "next/server";
import {withTransaction} from "../../../../../../../packages/db/connection";
import * as svc from "../../../../../../../packages/results/service";
import {protect} from "../../../../../../server/http";
import {p5Error,p5Mutation,noStore,resultStore} from "../../../../../../server/p5";
// Owner 2026-10-18 fallback channel: PDF status of the case and "อัปโหลด PDF ผลตรวจ" for one selected round/attempt.
// The file is screened and parsed here (not by the Worker), then compared with the selected target before anything is attached.
const MAX_BYTES=26*1024*1024;
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{const user=await protect(request),{id}=await params;return NextResponse.json(await withTransaction(db=>svc.caseResultStatus(db,user,id)),{headers:noStore});}catch(e){return p5Error(e);}}
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){return p5Mutation(request,"P5_CASE_UPLOAD",async user=>{
 const {id}=await params;
 if(Number(request.headers.get("content-length")??0)>MAX_BYTES)throw new Error("UPLOAD_TOO_LARGE");
 const form=await request.formData(),file=form.get("file");
 if(!file||typeof file==="string")throw new Error("FILE_REQUIRED");
 const attempt=form.get("attemptId");
 const target={caseId:id,roundId:String(form.get("roundId")??""),attemptId:typeof attempt==="string"&&attempt?attempt:null};
 const bytes=Buffer.from(await file.arrayBuffer());
 return NextResponse.json(await withTransaction(db=>svc.caseUploadCheck(db,user,resultStore(),{target,name:file.name,bytes})),{headers:noStore});
});}
