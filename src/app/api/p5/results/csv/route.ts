import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../../packages/db/connection';
import {exportResultPage,publicResultQuery} from '../../../../../../packages/results/query';
import {protect,readJson} from '../../../../../server/http';
import {p5Error,p5Mutation,noStore} from '../../../../../server/p5';
const response=(r:Awaited<ReturnType<typeof exportResultPage>>)=>new NextResponse(r.csv,{headers:{...noStore,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="synthetic-results-page-${r.page.number}.csv"`,'X-Result-Scope':'BOUNDED_PAGE','X-Result-Has-Next':String(r.page.hasNext),'X-Content-Type-Options':'nosniff'}});
/** Explicitly exports the same bounded page shown by the result query, never an implied full cohort. */
export async function GET(request:NextRequest){try{
 const user=await protect(request,'report.export'),r=await withTransaction(db=>exportResultPage(db,user,publicResultQuery(request.nextUrl.searchParams)));
 return response(r);
}catch(e){return p5Error(e);}}
export async function POST(request:NextRequest){return p5Mutation(request,'P7_CSV_QUERY',async user=>{publicResultQuery(request.nextUrl.searchParams);const data=await readJson(request);return response(await withTransaction(db=>exportResultPage(db,user,data)));});}
