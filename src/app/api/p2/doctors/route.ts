import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../packages/db/connection';
import {listDoctors,doctorAction,doctorUnits} from '../../../../../packages/p2/service';
import {protect,readJson} from '../../../../server/http';
import {p2Error,p2Mutation,noStore} from '../../../../server/p2/http';
export async function GET(request:NextRequest){try{const user=await protect(request);return await withTransaction(async db=>{
 const doctors=await listDoctors(db,user),id=request.nextUrl.searchParams.get('id');
 if(id){if(!doctors.some(d=>'id' in d&&d.id===id))return NextResponse.json({code:'FORBIDDEN'},{status:403,headers:noStore});
 const row=(await db.query<{signature_png:string}>('SELECT signature_png FROM p2_doctor_version WHERE id=$1',[id])).rows[0];
 const bytes=Buffer.from(row.signature_png,'base64');return new Response(bytes,{headers:{...noStore,'Content-Type':bytes[0]===255?'image/jpeg':'image/png','Content-Security-Policy':"default-src 'none'"}});}
 return NextResponse.json({doctors,units:await doctorUnits(db,user)},{headers:noStore});
 });}catch(e){return p2Error(e);}}
export async function POST(request:NextRequest){return p2Mutation(request,'P2_DOCTOR',async user=>{const input=await readJson(request,900000);return NextResponse.json(await withTransaction(db=>doctorAction(db,user,input)),{headers:noStore});});}
