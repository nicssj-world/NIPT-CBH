import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../packages/db/connection';
import {ancInsights} from '../../../../../packages/anc/insights';
import {recordPhiAccess} from '../../../../../packages/db/phi-access';
import {protect} from '../../../../server/http';
import {noStore,p4Error} from '../../../../server/p4';

/** ANC overview panel (Owner 2026-11-11): recent results, GA over 18 weeks, monthly statistics. Same scope and PHI-access record as the ANC queue. */
export async function GET(request:NextRequest){
 try{const user=await protect(request);const result=await withTransaction(async db=>{
  await db.query('SET TRANSACTION READ ONLY');
  return ancInsights(db,user,Object.fromEntries(request.nextUrl.searchParams));
 });
 const shown=[...result.highRisk.rows,...result.gaOver18.rows].map(r=>r.caseId);
 if(shown.length)await withTransaction(db=>recordPhiAccess(db,user.id,shown,'REGISTRY_VIEW'));
 return NextResponse.json(result,{headers:noStore});}catch(error){return p4Error(error);}
}
