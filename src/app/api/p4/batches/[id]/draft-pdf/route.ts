import {NextResponse,type NextRequest} from "next/server";
import {withTransaction} from "../../../../../../../packages/db/connection";
import * as rec from "../../../../../../../packages/lab/records";
import {readJson} from "../../../../../../server/http";
import {p4Mutation,labDeps} from "../../../../../../server/p4";
/** OD-B: uncontrolled DRAFT preview of a Task before Finalize (never stored, never a working copy). */
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){return p4Mutation(request,"P4_DRAFT_PREVIEW",async user=>{const {id}=await params;const input={...await readJson(request),batchId:id};
 const r=await withTransaction(db=>rec.previewDraftF2(db,user,input,labDeps()));
 return new NextResponse(new Uint8Array(r.bytes),{headers:{"Content-Type":"application/pdf","Content-Disposition":`inline; filename="${r.fileName.replace(/[^A-Za-z0-9._-]/g,"_")}"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","X-Document-Status":"DRAFT_PREVIEW"}});});}
