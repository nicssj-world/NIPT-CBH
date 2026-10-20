import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../packages/db/connection';
import {signingReturnStatus} from '../../../../../packages/p2/service';
import {readJson} from '../../../../server/http';
import {returnUser,p2Error,noStore} from '../../../../server/p2/http';
export async function POST(request:NextRequest){try{const user=await returnUser(request),input=await readJson(request);if(input.action==='status'&&Object.keys(input).length===1)return NextResponse.json(await withTransaction(db=>signingReturnStatus(db,user)),{headers:noStore});return NextResponse.json({error:'STAFF_MUST_SIGN_IN_AGAIN'}, {status:410,headers:noStore});}catch(e){return p2Error(e);}}
