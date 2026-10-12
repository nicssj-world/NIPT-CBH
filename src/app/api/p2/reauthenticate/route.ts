import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../packages/db/connection';
import {reauthenticate,signingReturnStatus} from '../../../../../packages/p2/service';
import {readJson} from '../../../../server/http';
import {returnUser,p2Error,noStore,SIGNING_COOKIE,SIGNING_CSRF} from '../../../../server/p2/http';
export async function POST(request:NextRequest){try{const user=await returnUser(request),input=await readJson(request);if(input.action==='status'&&Object.keys(input).length===1)return NextResponse.json(await withTransaction(db=>signingReturnStatus(db,user)),{headers:noStore});const result=await withTransaction(db=>reauthenticate(db,user,input));const response=NextResponse.json(result,{status:result.ok?200:401,headers:noStore});if(result.ok){response.cookies.delete(SIGNING_COOKIE);response.cookies.delete(SIGNING_CSRF);}return response;}catch(e){return p2Error(e);}}
