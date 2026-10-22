import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../../packages/db/connection';
import {manualReview,reviewManual} from '../../../../../../packages/historical/manual-review';
import {protect,readJson} from '../../../../../server/http';
import {noStore} from '../../../../../server/p4';
import {p5hError,p5hMutation} from '../../../../../server/p5h';
import {resultStore} from '../../../../../server/p5';
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{const user=await protect(request),{id}=await params;return NextResponse.json(await withTransaction(db=>manualReview(db,user,id)),{headers:noStore});}catch(e){return p5hError(e);}}
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){return p5hMutation(request,'LAB_MANUAL_REVIEW',async user=>{const {id}=await params,body=await readJson(request);return NextResponse.json(await withTransaction(db=>reviewManual(db,user,resultStore(),{...body,draftId:id})),{headers:noStore});});}
