import {NextResponse,type NextRequest} from 'next/server';
import {protect,apiError} from '../../../../server/http';
import {pool} from '../../../../../packages/db/connection';
import {listAnnualEqa} from '../../../../../packages/eqa/service';
export async function GET(request:NextRequest){
 try{
  const user=await protect(request,'case.read');
  const year=Number(new URL(request.url).searchParams.get('year'));
  return NextResponse.json({year,items:await listAnnualEqa(pool(),user,year)},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return apiError(e);}
}