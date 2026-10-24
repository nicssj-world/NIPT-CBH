import {NextResponse,type NextRequest} from "next/server";
import {withTransaction} from "../../../../../packages/db/connection";
import {signerOverview,listSigners,submitSignerProfile,decideSignerProfile,grantDelegation,revokeDelegation} from "../../../../../packages/readygen/signers";
import {protect,readJson} from "../../../../server/http";
import {noStore,resultStore} from "../../../../server/p5";
import {task3Error,task3Mutation,uploadedFile} from "../../../../server/task3";
/** GET: own profile/delegations (administrators: verification queue); ?role=REPORTED|APPROVED&q= searches eligible signers. */
export async function GET(request:NextRequest){try{const user=await protect(request),q=request.nextUrl.searchParams;
 const body=q.get("role")?{signers:await withTransaction(db=>listSigners(db,user,{role:q.get("role"),q:q.get("q")??""}))}:await withTransaction(db=>signerOverview(db,user));
 return NextResponse.json(body,{headers:noStore});}catch(e){return task3Error(e);}}
/** multipart: submit own profile (legalName, mtLicenseNo, signature). JSON: verify/revoke profile, grant/revoke delegation. */
export async function POST(request:NextRequest){return task3Mutation(request,"TASK3_SIGNER",async user=>{
 if(request.headers.get("content-type")?.startsWith("multipart/form-data")){const f=await uploadedFile(request,"signature",512*1024);
  return NextResponse.json(await withTransaction(db=>submitSignerProfile(db,user,resultStore(),{legalName:String(f.form.get("legalName")??""),mtLicenseNo:String(f.form.get("mtLicenseNo")??""),signature:f.bytes})),{headers:noStore});}
 const {action,...data}=await readJson(request);
 const r=await withTransaction(async db=>{if(action==="decideProfile")return decideSignerProfile(db,user,data);if(action==="grant")return grantDelegation(db,user,data);if(action==="revoke")return revokeDelegation(db,user,data);throw new Error("INVALID_REQUEST");});
 return NextResponse.json(r,{headers:noStore});});}
