import {type NextRequest} from "next/server";
import {z} from "zod";
import {withTransaction} from "../../../../../../packages/db/connection";
import {recordPhiAccess} from "../../../../../../packages/db/phi-access";
import {authorize} from "../../../../../../packages/security/policy";
import {protect} from "../../../../../server/http";
import {p4Error,noStore} from "../../../../../server/p4";

export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{
  const user=await protect(request),{id:raw}=await params,id=z.uuid().parse(raw);
  const record=await withTransaction(async db=>{
   const row=(await db.query<{case_id:string;content:Buffer;media_type:string}>(`SELECT r.case_id,e.content,e.media_type FROM specimen_rejection_evidence e
     JOIN specimen_acceptance a ON a.id=e.acceptance_id JOIN specimen_round r ON r.id=a.round_id
     WHERE e.id=$1 AND a.condition='REJECTED'`,[id])).rows[0];
   if(!row)return null;
   const units=(await db.query<{unit_id:string;registration_origin:"ANC"|"LAB_DIRECT"|"HISTORICAL"}>("SELECT s.unit_id,c.registration_origin FROM case_unit_scope s JOIN nipt_case c ON c.id=s.case_id WHERE c.id=$1",[row.case_id])).rows;
   if(!units.some(u=>authorize(user,"case.read",{unitId:u.unit_id,origin:u.registration_origin},"read")))return null;
   return row;
  });
  if(!record)return new Response(null,{status:404,headers:noStore});
  await withTransaction(db=>recordPhiAccess(db,user.id,[record.case_id],"REGISTRY_VIEW"));
  return new Response(new Uint8Array(record.content),{headers:{
   ...noStore,"Content-Type":record.media_type,"Content-Disposition":"inline",
   "Content-Security-Policy":"default-src 'none'; sandbox","X-Content-Type-Options":"nosniff"
  }});
 }catch(error){return p4Error(error);}
}
