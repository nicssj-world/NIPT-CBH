import {NextResponse,type NextRequest} from "next/server";
import {withTransaction} from "../../../../../packages/db/connection";
import {LabError,need} from "../../../../../packages/lab/core";
import * as svc from "../../../../../packages/run-photos/service";
import {putPhoto} from "../../../../../packages/run-photos/store";
import {photoMutation,boundedBody,noStore} from "../../../../server/run-photos";
// One photo per request (the browser sends several in sequence) so each gets its own progress, retry and result. The proxy is
// bypassed for this path (src/proxy.ts) because it would buffer and cut bodies above 10 MB; this handler enforces its own cap.
export async function POST(request:NextRequest){return photoMutation(request,"RUN_PHOTO_UPLOAD",async user=>{
 need(user,"photo.upload");
 const body=await boundedBody(request,svc.MAX_PHOTO_BYTES()+svc.MAX_THUMB_BYTES+256*1024);
 const form=await new Response(new Uint8Array(body),{headers:{"content-type":request.headers.get("content-type")??""}}).formData().catch(()=>{throw new LabError("FILE_REQUIRED",422);});
 const file=form.get("file"),thumb=form.get("thumb"),meta=form.get("meta");
 if(!(file instanceof File)||typeof meta!=="string")throw new LabError("FILE_REQUIRED",422);
 let raw:unknown;try{raw=JSON.parse(meta);}catch{throw new LabError("FILE_REQUIRED",422);}
 const prepared=svc.preparePhoto(raw,{name:file.name,bytes:Buffer.from(await file.arrayBuffer())},thumb instanceof File&&thumb.size?Buffer.from(await thumb.arrayBuffer()):null);
 // Bytes are written and verified before the record exists, so a record never points at a missing file. A failed record
 // leaves at most an unreferenced content-addressed file, which the consistency check reports.
 const root=await withTransaction(db=>svc.uploadRoot(db));
 const original=await putPhoto(root.root_path,prepared.bytes);
 const thumbHash=prepared.thumb?(await putPhoto(root.root_path,prepared.thumb)).hash:null;
 const result=await withTransaction(db=>svc.recordPhoto(db,user,prepared,{root,sha256:original.hash,thumbSha256:thumbHash}));
 return NextResponse.json({...result,sha256:original.hash},{status:result.replayed?200:201,headers:noStore});});}
