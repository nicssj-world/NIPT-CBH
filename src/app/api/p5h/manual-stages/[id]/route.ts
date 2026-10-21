import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../../packages/db/connection';
import {manualStages,recordManualStages} from '../../../../../../packages/historical/manual-stages';
import {protect,readJson} from '../../../../../server/http';
import {p4Mutation,p4Error,noStore} from '../../../../../server/p4';
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{const user=await protect(request),{id}=await params;return NextResponse.json(await withTransaction(db=>manualStages(db,user,id)),{headers:noStore});}catch(e){return p4Error(e);}}
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){return p4Mutation(request,'LAB_MANUAL_PAPER',async user=>{const {id}=await params,body=await readJson(request);return NextResponse.json(await withTransaction(db=>recordManualStages(db,user,{...body,draftId:id})),{headers:noStore});});}
