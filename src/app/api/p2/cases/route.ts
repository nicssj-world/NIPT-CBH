import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../packages/db/connection';
import {listP2Cases} from '../../../../../packages/p2/service';
import {protect} from '../../../../server/http';
import {parseSortDirection,REGISTRY_DEFAULT_SORT} from '../../../../../packages/lab/receive-sort';
import {p2Error,noStore} from '../../../../server/p2/http';
export async function GET(request:NextRequest){try{const user=await protect(request);return NextResponse.json(await withTransaction(db=>listP2Cases(db,user,request.nextUrl.searchParams.get('q')??'',Number(request.nextUrl.searchParams.get('offset')??0),parseSortDirection(request.nextUrl.searchParams.get('sort'),REGISTRY_DEFAULT_SORT))),{headers:noStore});}catch(e){return p2Error(e);}}
