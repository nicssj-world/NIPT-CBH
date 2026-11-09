import {NextResponse,type NextRequest} from "next/server";
import {withTransaction} from "../../../../packages/db/connection";
import {nhsoBoard,nhsoDetail,exportNhsoXlsx,confirmNhsoEntry,markNotNhso,cancelNhsoEntry} from "../../../../packages/results/nhso-entry";
import {protect,readJson} from "../../../server/http";
import {p5Error,p5Mutation,noStore,resultStore} from "../../../server/p5";

/** ลงผลสปสช.: `?releaseId=` returns one popup's patient data (read from the stored PET), otherwise the board. */
export async function GET(request:NextRequest){try{const user=await protect(request,"nhso.entry");const p=request.nextUrl.searchParams,releaseId=p.get("releaseId");
 const r=await withTransaction<unknown>(db=>releaseId?nhsoDetail(db,resultStore(),user,releaseId):nhsoBoard(db,user,{tab:p.get("tab")??"PENDING",q:p.get("q")??"",from:p.get("from")||undefined,to:p.get("to")||undefined,page:Number(p.get("page")??1),pageSize:Number(p.get("pageSize")??50)}));
 return NextResponse.json(r,{headers:noStore});}catch(e){return p5Error(e);}}

/** The export is a POST (not a link) so a searched LN/HN never appears in a URL. */
const XLSX="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export async function POST(request:NextRequest){return p5Mutation(request,"NHSO_ENTRY",async user=>{const {action,...data}=await readJson(request,4096);
 if(action==="export"){const x=await withTransaction(db=>exportNhsoXlsx(db,user,data)),day=new Date(Date.now()+7*3600000).toISOString().slice(0,10).replaceAll("-","");
  return new NextResponse(new Uint8Array(x.bytes),{headers:{...noStore,"Content-Type":XLSX,"Content-Disposition":`attachment; filename="nhso-${String(data.tab??"export").toLowerCase().replace(/[^a-z]/g,"-")}-${day}.xlsx"`}});}
 const r=await withTransaction<unknown>(db=>{
  if(action==="board")return nhsoBoard(db,user,data);
  if(action==="confirm")return confirmNhsoEntry(db,user,data);
  if(action==="notNhso")return markNotNhso(db,user,data);
  if(action==="cancel")return cancelNhsoEntry(db,user,data);
  throw new Error("INVALID_REQUEST");});
 return NextResponse.json(r,{headers:noStore});});}
