import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../packages/db/connection';
import {deleteEqaRegistration} from '../../../../../packages/eqa/service';
import {readJson} from '../../../../server/http';
import {p2Mutation,noStore} from '../../../../server/p2/http';
/** Deletes an EQA registration that nothing was built on; the database refuses otherwise and keeps a tombstone and the audit trail. */
export async function POST(request:NextRequest){return p2Mutation(request,'EQA_DELETE',async user=>{const input=await readJson(request);return NextResponse.json(await withTransaction(db=>deleteEqaRegistration(db,user,input)),{headers:noStore});});}
