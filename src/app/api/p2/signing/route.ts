import {cookies} from 'next/headers';
import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../packages/db/connection';
import {readSigning,patientAction,P2Error} from '../../../../../packages/p2/service';
import {assertSynthetic,configuredOrigin} from '../../../../../packages/security/runtime';
import {readJson} from '../../../../server/http';
import {p2Error,noStore,SIGNING_COOKIE,SIGNING_CSRF} from '../../../../server/p2/http';
async function signingToken(){assertSynthetic();const jar=await cookies(),raw=jar.get(SIGNING_COOKIE)?.value;if(!raw)throw new P2Error('SIGNING_SESSION_INVALID',401);return raw;}
export async function GET(){try{return NextResponse.json(await withTransaction(async db=>readSigning(db,await signingToken())),{headers:noStore});}catch(e){return p2Error(e);}}
export async function POST(request:NextRequest){try{const raw=await signingToken(),input=await readJson(request,65536);const result=await withTransaction(db=>patientAction(db,raw,input,{origin:request.headers.get('origin'),expectedOrigin:configuredOrigin().origin,token:request.headers.get('x-csrf-token')??''}));const response=NextResponse.json(result,{headers:noStore});if(input.action==='complete'||input.action==='cancel'){response.cookies.delete(SIGNING_COOKIE);response.cookies.delete(SIGNING_CSRF);}return response;}catch(e){return p2Error(e);}}
