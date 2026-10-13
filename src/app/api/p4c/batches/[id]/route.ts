import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../../packages/db/connection';
import * as core from '../../../../../../packages/sequencing/service';
import {issueF5} from '../../../../../../packages/sequencing/documents';
import {protect,readJson} from '../../../../../server/http';
import {p4Error,p4Mutation,noStore} from '../../../../../server/p4';
import {f5Deps,sequencingWorkspace} from '../../../../../server/p4c';
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{const user=await protect(request),{id}=await params;return NextResponse.json(await withTransaction(db=>sequencingWorkspace(db,user,id)),{headers:noStore});}catch(e){return p4Error(e);}}
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){return p4Mutation(request,'P4C_SEQUENCE',async user=>{
 const {id}=await params,{action,...data}=await readJson(request,150000),input={...data,batchId:id};
 if(action==='previewF5'){const r=await withTransaction(db=>issueF5(db,user,input,f5Deps(),true));if(!r.bytes)throw Error('PREVIEW_FAILED');return new NextResponse(new Uint8Array(r.bytes),{headers:{...noStore,'Content-Type':'application/pdf'}});}
 return NextResponse.json(await withTransaction<unknown>(async db=>{switch(action){
  case 'createDnb':return core.createDnb(db,user,input);case 'transition':return core.transition(db,user,input);
  case 'recordObservation':return core.recordObservation(db,user,input);case 'reviewObservation':return core.reviewObservation(db,user,input);case 'decideQc3':return core.decideQc3(db,user,input);
  case 'createHandoff':return core.createHandoff(db,user,input);case 'transferHandoff':return core.transferHandoff(db,user,input);case 'verifyHandoff':return core.verifyHandoff(db,user,input);
  case 'createSequencing':return core.createSequencing(db,user,input);case 'transitionSequencing':return core.transitionSequencing(db,user,input);case 'recordQc4':return core.recordQc4(db,user,input);case 'reviewQc4':return core.reviewQc4(db,user,input);
  case 'issueF5':return issueF5(db,user,input,f5Deps());case 'recall':return core.recallCopy(db,user,input);
  case 'issueOperational':case 'accept':case 'export':return core.operationalGate(db,user,input);
  default:throw Error('ACTION_NOT_ALLOWED');}}),{headers:noStore});
 });}
