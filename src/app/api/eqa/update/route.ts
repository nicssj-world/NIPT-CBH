import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../packages/db/connection';
import {updateEqaInfo} from '../../../../../packages/eqa/service';
import {readJson} from '../../../../server/http';
import {p2Mutation,noStore} from '../../../../server/p2/http';
/** Corrects the basic data of an EQA specimen until a report exists; the database refuses afterwards. */
export async function POST(request:NextRequest){return p2Mutation(request,'EQA_UPDATE',async user=>{const input=await readJson(request);return NextResponse.json(await withTransaction(db=>updateEqaInfo(db,user,input)),{headers:noStore});});}
