import {NextResponse,type NextRequest} from "next/server";
import {withTransaction} from "../../../../../../packages/db/connection";
import * as svc from "../../../../../../packages/results/service";
import {p5Mutation,noStore,resultStore} from "../../../../../server/p5";
// Browser file picker (alternative to the folder workflow, as in NIPTY). Bytes are quarantined and parsed by the worker.
const MAX_TOTAL=20*25*1024*1024;
export async function POST(request:NextRequest){return p5Mutation(request,"P5_UPLOAD",async user=>{
 if(Number(request.headers.get("content-length")??0)>MAX_TOTAL)throw new Error("UPLOAD_TOO_LARGE");
 const form=await request.formData();const files=form.getAll("files").filter((x):x is File=>typeof x!=="string");
 const items=await Promise.all(files.map(async f=>({name:f.name,bytes:Buffer.from(await f.arrayBuffer())})));
 return NextResponse.json(await withTransaction(db=>svc.registerUploads(db,user,resultStore(),items)),{status:202,headers:noStore});});}
