import {readFile} from 'node:fs/promises';
import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../packages/db/connection';
import {registerP2} from '../../../../../packages/p2/service';
import {readJson} from '../../../../server/http';
import {p2Mutation,noStore} from '../../../../server/p2/http';
export async function POST(request:NextRequest){return p2Mutation(request,'P2_REGISTER',async user=>{const input=await readJson(request);const key=await readFile(/* turbopackIgnore: true */ process.env.IDENTITY_LOOKUP_KEY_FILE??'');return NextResponse.json(await withTransaction(db=>registerP2(db,user,input,key)),{headers:noStore});});}
