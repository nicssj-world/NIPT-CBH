import {NextResponse,type NextRequest} from "next/server";
import {withTransaction} from "../../../../../../../packages/db/connection";
import {readSignatureImage} from "../../../../../../../packages/readygen/signers";
import {protect} from "../../../../../../server/http";
import {noStore,resultStore} from "../../../../../../server/p5";
import {task3Error} from "../../../../../../server/task3";
/** A stored signature image: its owner and administrators (for verification) only; every view is audited. */
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{const user=await protect(request),{id}=await params;
 const r=await withTransaction(db=>readSignatureImage(db,user,resultStore(),id));
 return new NextResponse(new Uint8Array(r.bytes),{headers:{...noStore,"Content-Type":r.media,"Cache-Control":"private, no-store","Content-Disposition":"inline"}});}catch(e){return task3Error(e);}}
