import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../../packages/db/connection';
import * as service from '../../../../../../packages/p2/service';
import {protect,readJson,cookieOptions} from '../../../../../server/http';
import {p2Error,p2Mutation,noStore,SIGNING_COOKIE,SIGNING_CSRF} from '../../../../../server/p2/http';
export async function GET(request:NextRequest,context:{params:Promise<{id:string}>}){try{const user=await protect(request),{id}=await context.params;return NextResponse.json(await withTransaction(db=>service.getCase(db,user,id)),{headers:noStore});}catch(e){return p2Error(e);}}
export async function POST(request:NextRequest,context:{params:Promise<{id:string}>}){return p2Mutation(request,'P2_CASE_MUTATION',async user=>{const {id}=await context.params,input=await readJson(request,65536),{action,...data}=input;
 const operations:Record<string,(db:import('../../../../../../packages/db/connection').Queryable,user:service.Staff,id:string,data:unknown)=>Promise<unknown>>={saveRequest:service.saveRequest,lockRequest:service.lockRequest,setModes:service.setModes,paperReview:service.paperReview,preparePaper:service.preparePaper,prepareConsent:service.prepareConsent,withdraw:service.withdraw};
 if(action==='startSigning'){const result=await withTransaction(db=>service.startSigning(db,user,id,data));const response=NextResponse.json({sessionId:result.sessionId,expiresAt:result.expiresAt},{headers:noStore});response.cookies.set(SIGNING_COOKIE,result.raw,{...cookieOptions(),maxAge:10*60});response.cookies.set(SIGNING_CSRF,result.csrf,{...cookieOptions(),httpOnly:false,maxAge:10*60});return response;}
 if(typeof action!=='string'||!(action in operations))throw new service.P2Error('ACTION_NOT_ALLOWED');return NextResponse.json(await withTransaction(db=>operations[action as keyof typeof operations](db,user,id,data)),{headers:noStore});
 });}
