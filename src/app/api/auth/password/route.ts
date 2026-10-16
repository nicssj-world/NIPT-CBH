import {NextResponse,type NextRequest} from 'next/server';
import {protect,apiError,readJson,SESSION_COOKIE,CSRF_COOKIE,cookieOptions} from '../../../../server/http';
import {withTransaction} from '../../../../../packages/db/connection';
import {changePassword} from '../../../../../packages/admin/service';
import {z} from 'zod';
export async function POST(request:NextRequest){try{const user=await protect(request);const input=z.object({current:z.string().max(128),next:z.string().max(128)}).strict().parse(await readJson(request));const changed=await withTransaction(db=>changePassword(db,user,input.current,input.next));if(!changed)throw Error('CURRENT_PASSWORD_INVALID');const r=NextResponse.json({ok:true},{headers:{'Cache-Control':'no-store'}});for(const name of [SESSION_COOKIE,CSRF_COOKIE])r.cookies.set(name,'',{...cookieOptions(),maxAge:0});return r;}catch(e){return apiError(e);}}
