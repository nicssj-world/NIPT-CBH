import {NextResponse,type NextRequest} from "next/server";
import {withTransaction} from "../../../../../../packages/db/connection";
import {exportWorklistXlsx} from "../../../../../../packages/lab/worklist-export";
import {protect} from "../../../../../server/http";
import {p4Error,noStore} from "../../../../../server/p4";
/** OWNER-LAB-011: LN / LN Halos spreadsheet of the current LAB queue (GET download; read permission and PHI log in the export). */
export async function GET(request:NextRequest){try{const user=await protect(request);const r=await withTransaction(db=>exportWorklistXlsx(db,user));
 const day=new Date(Date.now()+7*3600000).toISOString().slice(0,10).replaceAll("-","");
 return new NextResponse(new Uint8Array(r.bytes),{headers:{...noStore,"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":`attachment; filename="lab-ln-halos-${day}.xlsx"`}});}catch(e){return p4Error(e);}}
