import {NextResponse,type NextRequest} from 'next/server';
import {protect,apiError} from '../../../../server/http';
import {pool} from '../../../../../packages/db/connection';
import {listAudit} from '../../../../../packages/admin/service';
export async function GET(request:NextRequest){try{const user=await protect(request,'audit.read');return NextResponse.json(await listAudit(pool(),user,Object.fromEntries(request.nextUrl.searchParams)),{headers:{'Cache-Control':'no-store'}});}catch(e){return apiError(e);}}
