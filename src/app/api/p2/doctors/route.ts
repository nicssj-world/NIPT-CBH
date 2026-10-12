import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../packages/db/connection';
import {listDoctors,doctorAction,doctorUnits} from '../../../../../packages/p2/service';
import {protect,readJson} from '../../../../server/http';
import {p2Error,p2Mutation,noStore} from '../../../../server/p2/http';
export async function GET(request:NextRequest){try{const user=await protect(request);return NextResponse.json(await withTransaction(async db=>({doctors:await listDoctors(db,user),units:await doctorUnits(db,user)})),{headers:noStore});}catch(e){return p2Error(e);}}
export async function POST(request:NextRequest){return p2Mutation(request,'P2_DOCTOR',async user=>{const input=await readJson(request,65536);return NextResponse.json(await withTransaction(db=>doctorAction(db,user,input)),{headers:noStore});});}
