import {NextResponse,type NextRequest} from "next/server";
import {z} from "zod";
import {withTransaction} from "../../../../../packages/db/connection";
import {recordPhiAccess} from "../../../../../packages/db/phi-access";
import {authorize} from "../../../../../packages/security/policy";
import {protect} from "../../../../server/http";
import {p4Error,noStore} from "../../../../server/p4";

export async function GET(request:NextRequest){
 try{
  const user=await protect(request),caseId=z.uuid().parse(request.nextUrl.searchParams.get("caseId"));
  const scope=await withTransaction(async db=>{
   const units=(await db.query<{unit_id:string;registration_origin:"ANC"|"LAB_DIRECT"|"HISTORICAL"}>("SELECT u.unit_id,c.registration_origin FROM case_unit_scope u JOIN nipt_case c ON c.id=u.case_id WHERE c.id=$1",[caseId])).rows;
   if(!units.some(u=>authorize(user,"case.read",{unitId:u.unit_id,origin:u.registration_origin},"read")))return null;
   const photos=(await db.query<{id:string;sequence:number;round_number:number;created_at:Date}>(`SELECT e.id,e.sequence,r.round_number,e.created_at FROM specimen_rejection_evidence e
     JOIN specimen_acceptance a ON a.id=e.acceptance_id
     JOIN specimen_round r ON r.id=a.round_id
     WHERE r.case_id=$1 AND a.condition='REJECTED' ORDER BY r.round_number DESC,a.created_at DESC,e.sequence ASC LIMIT 60`,[caseId])).rows;
   return photos.map(p=>({id:p.id,sequence:p.sequence,roundNumber:p.round_number,createdAt:p.created_at}));
  });
  if(!scope)return NextResponse.json({code:"FORBIDDEN"},{status:403,headers:noStore});
  if(scope.length)await withTransaction(db=>recordPhiAccess(db,user.id,[caseId],"REGISTRY_VIEW"));
  return NextResponse.json({photos:scope},{headers:noStore});
 }catch(e){return p4Error(e);}
}
