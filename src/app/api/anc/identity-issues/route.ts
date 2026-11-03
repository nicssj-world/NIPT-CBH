import {NextResponse,type NextRequest} from "next/server";
import {z} from "zod";
import {withTransaction} from "../../../../../packages/db/connection";
import {recordPhiAccess} from "../../../../../packages/db/phi-access";
import {authorize} from "../../../../../packages/security/policy";
import {protect,readJson} from "../../../../server/http";
import {noStore,p4Error} from "../../../../server/p4";

/** Scope-checked read of HIS identity exceptions; no raw PET or patient identifiers leave this endpoint. */
export async function POST(request:NextRequest){
 try{
  const user=await protect(request);
  if(!user.roles.some(role=>["ANC_NURSE","ANC_SUPERVISOR","APP_ADMIN"].includes(role)))return NextResponse.json({code:"FORBIDDEN"},{status:403,headers:noStore});
  const {caseId}=z.strictObject({caseId:z.uuid()}).parse(await readJson(request));
  const rows=await withTransaction(async db=>{
   const units=(await db.query<{unit_id:string;registration_origin:string}>(`SELECT s.unit_id,c.registration_origin FROM case_unit_scope s JOIN nipt_case c ON c.id=s.case_id WHERE c.id=$1`,[caseId])).rows;
   if(!units.some(u=>authorize(user,"case.read",{unitId:u.unit_id,origin:"ANC"},"read")&&authorize(user,"result.read.released",{unitId:u.unit_id,origin:"ANC"},"read")))return null;
   const issues=(await db.query<{id:string;kind:string;state:string;details:{fields?:unknown}|null;created_at:Date}>(`SELECT id,kind,state,details,created_at FROM his_intake_issue WHERE case_id=$1 AND state IN ('Open','Proposed') ORDER BY created_at DESC,id DESC LIMIT 20`,[caseId])).rows;
   return issues.map(i=>({id:i.id,kind:i.kind,state:i.state,fields:Array.isArray(i.details?.fields)?i.details.fields.filter((v):v is string=>typeof v==="string").slice(0,20):[],createdAt:i.created_at}));
  });
  if(!rows)return NextResponse.json({code:"FORBIDDEN"},{status:403,headers:noStore});
  await withTransaction(db=>recordPhiAccess(db,user.id,[caseId],"REGISTRY_VIEW"));
  return NextResponse.json({issues:rows},{headers:noStore});
 }catch(error){return p4Error(error);}
}
