import {NextResponse,type NextRequest} from "next/server";
import {withTransaction} from "../../../../../packages/db/connection";
import {templateOverview,uploadTemplate,testTemplate,approveTemplate,rejectTemplate,activateTemplate,previewPdf,listTemplateFolder,readTemplateFolderFile} from "../../../../../packages/readygen/template-registry";
import {protect,readJson} from "../../../../server/http";
import {noStore,resultStore} from "../../../../server/p5";
import {fileResponse,task3Error,task3Mutation,uploadedFile} from "../../../../server/task3";
/** OWNER-LAB-056 Settings -> report templates. GET: overview | ?preview=<id> (watermarked PDF) | ?folder=<path> (read-only .docx listing).
 *  POST multipart: upload a .docx. POST JSON: import (from folder) | test | approve | reject | activate. Authority is decided in the service. */
export async function GET(request:NextRequest){try{const user=await protect(request,"settings.read"),q=request.nextUrl.searchParams;
 if(q.get("preview")){const r=await withTransaction(db=>previewPdf(db,user,resultStore(),q.get("preview")!));return fileResponse(r.bytes,"application/pdf",r.name,true);}
 if(q.get("folder"))return NextResponse.json(await listTemplateFolder(user,q.get("folder")!),{headers:noStore});
 return NextResponse.json(await withTransaction(db=>templateOverview(db,user)),{headers:noStore});}catch(e){return task3Error(e);}}
export async function POST(request:NextRequest){return task3Mutation(request,"REPORT_TEMPLATE",async user=>{
 if(request.headers.get("content-type")?.startsWith("multipart/form-data")){const f=await uploadedFile(request,"file",5*1024*1024);
  return NextResponse.json(await withTransaction(db=>uploadTemplate(db,user,resultStore(),{kind:String(f.form.get("kind")??""),name:f.name,bytes:f.bytes,reason:String(f.form.get("reason")??""),source:"UPLOAD",sourcePath:null})),{headers:noStore});}
 const {operation,...data}=await readJson(request);
 const r=await withTransaction(async db=>{
  if(operation==="import"){const f=await readTemplateFolderFile(user,String(data.folder??""),String(data.name??""));return uploadTemplate(db,user,resultStore(),{kind:String(data.kind??""),name:String(data.name),bytes:f.bytes,reason:String(data.reason??""),source:"FOLDER",sourcePath:f.base});}
  if(operation==="test")return testTemplate(db,user,resultStore(),String(data.id??""));
  if(operation==="approve")return approveTemplate(db,user,{id:data.id,acknowledgeProductDifference:data.acknowledgeProductDifference===true});
  if(operation==="reject")return rejectTemplate(db,user,{id:data.id,reason:data.reason});
  if(operation==="activate")return activateTemplate(db,user,{id:data.id});
  throw new Error("INVALID_REQUEST");});
 return NextResponse.json(r,{headers:noStore});});}
