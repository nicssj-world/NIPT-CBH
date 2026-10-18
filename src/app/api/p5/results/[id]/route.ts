import {NextResponse,type NextRequest} from "next/server";
import {withTransaction,type Queryable} from "../../../../../../packages/db/connection";
import * as svc from "../../../../../../packages/results/service";
import type {Staff} from "../../../../../../packages/lab/core";
import {protect,readJson} from "../../../../../server/http";
import {p5Error,p5Mutation,noStore} from "../../../../../server/p5";
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{const user=await protect(request),{id}=await params;return NextResponse.json(await withTransaction(db=>svc.versionDetail(db,user,id)),{headers:noStore});}catch(e){return p5Error(e);}}
type Op=(db:Queryable,user:Staff,input:unknown)=>Promise<unknown>;
const actions:Record<string,Op>={propose:svc.proposeLink,proposeAuto:svc.proposeAutoMatch,acceptRelease:svc.acceptAndRelease,decide:svc.decideLink,unlink:svc.unlinkVersion,review:svc.recordReview,qc5:svc.recordQc5,revalidate:svc.revalidate,certify:svc.certifyAttempt,void:svc.voidVersion};
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){return p5Mutation(request,"P5_RESULT",async user=>{const {id}=await params;const {action,...data}=await readJson(request);
 if(typeof action!=="string"||!(action in actions))throw new Error("INVALID_REQUEST");
 return NextResponse.json(await withTransaction(db=>actions[action](db,user,{...data,versionId:id})),{headers:noStore});});}
