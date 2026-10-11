import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../packages/db/connection';
import {listP2Cases} from '../../../../../packages/p2/service';
import {protect} from '../../../../server/http';
import {p2Error,noStore} from '../../../../server/p2/http';
export async function GET(request:NextRequest){try{const user=await protect(request);return NextResponse.json(await withTransaction(db=>listP2Cases(db,user,request.nextUrl.searchParams.get('q')??'')),{headers:noStore});}catch(e){return p2Error(e);}}
