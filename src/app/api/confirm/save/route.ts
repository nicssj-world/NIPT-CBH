import {NextResponse,type NextRequest} from "next/server";
import {withTransaction} from "../../../../../packages/db/connection";
import {saveConfirm} from "../../../../../packages/confirm/service";
import {PDF_MAX_BYTES} from "../../../../../packages/confirm/model";
import {LabError} from "../../../../../packages/lab/core";
import {protect} from "../../../../server/http";
import {noStore,resultStore} from "../../../../server/p5";
import {confirmError} from "../../../../server/confirm";

/** Record a confirmatory result: multipart `data` (JSON fields) and an optional `file` (the outlab PDF, at most 8 MB). */
export async function POST(request:NextRequest){try{const user=await protect(request,"confirm.write",{},"write");
 if(Number(request.headers.get("content-length")??0)>PDF_MAX_BYTES+64*1024)throw new LabError("FILE_TOO_LARGE",413);
 const form=await request.formData(),data=form.get("data"),file=form.get("file");
 if(typeof data!=="string"||data.length>8192)throw new Error("INVALID_REQUEST");
 const pdf=file&&typeof file!=="string"&&file.size>0?Buffer.from(await file.arrayBuffer()):null;
 const r=await withTransaction(db=>saveConfirm(db,resultStore(),user,JSON.parse(data),pdf));
 return NextResponse.json(r,{headers:noStore});}catch(e){return confirmError(e);}}
