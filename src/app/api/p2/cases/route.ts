import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../packages/db/connection';
import {listP2Cases,registrySummary} from '../../../../../packages/p2/service';
import {protect} from '../../../../server/http';
import {p2Error,noStore} from '../../../../server/p2/http';
export async function GET(request:NextRequest){try{const user=await protect(request);const params=Object.fromEntries(request.nextUrl.searchParams),summary=params.summary==='1';delete params.summary;
 // summary=1: the dashboards' counts (no rows, no identifiers).
 return NextResponse.json(await (summary?withTransaction(db=>registrySummary(db,user,params)):withTransaction(db=>listP2Cases(db,user,params))),{headers:noStore});}catch(e){return p2Error(e);}}
