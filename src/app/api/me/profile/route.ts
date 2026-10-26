import {NextResponse,type NextRequest} from 'next/server';
import {protect,apiError,readJson} from '../../../../server/http';
import {pool,withTransaction} from '../../../../../packages/db/connection';
import {readOwnProfile,saveOwnProfile} from '../../../../../packages/profile/service';
export async function GET(request:NextRequest){try{const user=await protect(request);return NextResponse.json(await readOwnProfile(pool(),user),{headers:{'Cache-Control':'no-store'}});}catch(e){return apiError(e);}}
export async function POST(request:NextRequest){try{const user=await protect(request),input=await readJson(request,720000);return NextResponse.json(await withTransaction(db=>saveOwnProfile(db,user,input)),{headers:{'Cache-Control':'no-store'}});}catch(e){return apiError(e);}}
