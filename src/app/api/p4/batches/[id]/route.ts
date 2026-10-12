import {NextResponse,type NextRequest} from "next/server";
import {withTransaction,type Queryable} from "../../../../../../packages/db/connection";
import * as batch from "../../../../../../packages/lab/batch";
import * as rec from "../../../../../../packages/lab/records";
import type {Staff} from "../../../../../../packages/lab/core";
import {protect,readJson} from "../../../../../server/http";
import {p4Error,p4Mutation,noStore,labDeps} from "../../../../../server/p4";
import {batchWorkspace} from "../../../../../server/p4-data";
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{const user=await protect(request),{id}=await params;return NextResponse.json(await withTransaction(db=>batchWorkspace(db,user,id)),{headers:noStore});}catch(e){return p4Error(e);}}
type Op=(db:Queryable,user:Staff,input:unknown)=>Promise<unknown>;
const docs=(fn:(db:Queryable,user:Staff,input:unknown,deps:rec.DocDeps)=>Promise<unknown>):Op=>(db,user,input)=>fn(db,user,input,labDeps());
const actions:Record<string,Op>={assign:batch.assignToBatch,move:batch.moveSlot,remove:batch.removeFromBatch,updatePlan:batch.updateSheetPlan,planCheck:batch.planCheck,finalize:batch.finalizeSheet,amend:batch.amendSheet,cancel:batch.cancelBatch,
 start:batch.startExecution,end:batch.endExecution,record:rec.recordObservation,review:rec.reviewObservations,proposeDisposition:rec.proposeDisposition,confirmDisposition:rec.confirmDisposition,verify:rec.verifyExecution,decideQc:rec.decideStageQc1,
 issuePreWork:docs(rec.issuePreWork),issueQcPreWork:docs(rec.issueQcPreWork),issueCompleted:docs(rec.issueCompleted),issueQcCompleted:docs(rec.issueQcCompleted)};
// Actions addressed by their own record ids (observation/disposition/attempt) do not take the batch id from the path.
const OWN_ID=new Set(["review","confirmDisposition","decideQc"]);
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){return p4Mutation(request,"P4_BATCH",async user=>{const {id}=await params;const {action,...data}=await readJson(request,65536);
 if(typeof action!=="string"||!(action in actions))throw new Error("ACTION_NOT_ALLOWED");
 // These act on their own row (with its own lock); the batch version is not part of their contract.
 const {expectedVersion:_version,...own}=data;void _version;
 const input=OWN_ID.has(action)?own:{...data,batchId:id};
 return NextResponse.json(await withTransaction(db=>actions[action](db,user,input)),{headers:noStore});});}
