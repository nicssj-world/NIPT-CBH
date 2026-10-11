import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../packages/db/connection';
import {reauthenticate} from '../../../../../packages/p2/service';
import {readJson} from '../../../../server/http';
import {returnUser,p2Error,noStore,SIGNING_COOKIE,SIGNING_CSRF} from '../../../../server/p2/http';
export async function POST(request:NextRequest){try{const user=await returnUser(request),input=await readJson(request);const result=await withTransaction(db=>reauthenticate(db,user,input));const response=NextResponse.json(result,{status:result.ok?200:401,headers:noStore});if(result.ok){response.cookies.delete(SIGNING_COOKIE);response.cookies.delete(SIGNING_CSRF);}return response;}catch(e){return p2Error(e);}}
