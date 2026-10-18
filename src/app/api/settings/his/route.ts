import {NextResponse,type NextRequest} from 'next/server';
import {protect,readJson,apiError} from '../../../../server/http';
import {settingsError} from '../../../../server/settings-errors';
import {pool,withTransaction} from '../../../../../packages/db/connection';
import {hisMonitoring,requestHisRetry} from '../../../../../packages/settings/his-monitoring';
import {requestHisTest} from '../../../../../packages/settings/his';
import {readHistory} from '../../../../../packages/p6/journal';
export async function GET(request:NextRequest){try{await protect(request,'settings.read');const id=request.nextUrl.searchParams.get('history');return NextResponse.json(id?await readHistory(pool(),id):await hisMonitoring(pool()),{headers:{'Cache-Control':'no-store'}});}catch(e){return apiError(e);}}
export async function POST(request:NextRequest){try{const user=await protect(request,'settings.read'),input=await readJson(request);const result=await withTransaction(async db=>{if(input.operation==='test_active')return requestHisTest(db,user,String(input.id),true);if(input.operation==='retry')return requestHisRetry(db,user,String(input.id));throw Error('INVALID_OPERATION');});return NextResponse.json(result,{status:202,headers:{'Cache-Control':'no-store'}});}catch(e){return settingsError(e);}}
