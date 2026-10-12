import {NextResponse,type NextRequest} from "next/server";
import {protect} from "../../../../../server/http";
import {getLabelSheet,p4Error} from "../../../../../server/p4";
// Excluded from the app proxy CSP: this document is the escaped Genomic-CBH label HTML and may only style itself.
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{const user=await protect(request,"label.print",{},"write");const {id}=await params;
 const html=/^[a-f0-9-]{36}$/.test(id)&&user.sessionId?getLabelSheet(id,user.sessionId):null;if(!html)return new NextResponse("หมดอายุหรือไม่มีสิทธิ์",{status:404,headers:{"Cache-Control":"no-store"}});
 return new NextResponse(html,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'","Referrer-Policy":"no-referrer"}});}catch(e){return p4Error(e);}}
