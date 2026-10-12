import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../packages/db/connection';
import {registrationIntakePresence} from '../../../../../packages/p2/service';
import {readJson} from '../../../../server/http';
import {p2Mutation,noStore} from '../../../../server/p2/http';
// POST keeps the LN out of URLs and logs; the answer is presence only (blind entry, Plan §4.7 L2).
export async function POST(request:NextRequest){return p2Mutation(request,'P2_INTAKE_PRESENCE',async user=>{const input=await readJson(request,1024);return NextResponse.json(await withTransaction(db=>registrationIntakePresence(db,user,input)),{headers:noStore});});}
