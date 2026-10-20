import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../packages/db/connection';
import {reauthenticate,signingReturnStatus} from '../../../../../packages/p2/service';
import {readJson} from '../../../../server/http';
import {returnUser,p2Error,noStore} from '../../../../server/p2/http';
export async function POST(request:NextRequest){try{const user=await returnUser(request),input=await readJson(request);if(input.action==='status'&&Object.keys(input).length===1)return NextResponse.json(await withTransaction(db=>signingReturnStatus(db,user)),{headers:noStore});if(input.action==='return'){const handoff={sessionId:input.sessionId,outcome:input.outcome};return NextResponse.json(await withTransaction(db=>reauthenticate(db,user,handoff)),{headers:noStore});}return NextResponse.json({error:'SIGNING_HANDOFF_INVALID'}, {status:422,headers:noStore});}catch(e){return p2Error(e);}}
