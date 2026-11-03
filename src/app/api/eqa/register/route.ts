import {readFile} from 'node:fs/promises';
import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../packages/db/connection';
import {registerEqaCase} from '../../../../../packages/eqa/service';
import {readJson} from '../../../../server/http';
import {p2Mutation,noStore} from '../../../../server/p2/http';
import {inboundStore} from '../../../../server/p3/inbound';
/** Registers an EQA specimen from the organizer's referral card and records its receipt (no HIS PET). Same permission as a LAB registration. */
export async function POST(request:NextRequest){return p2Mutation(request,'EQA_REGISTER',async user=>{const input=await readJson(request);const key=await readFile(/* turbopackIgnore: true */ process.env.IDENTITY_LOOKUP_KEY_FILE??'');return NextResponse.json(await withTransaction(db=>registerEqaCase(db,user,input,key,{store:inboundStore()})),{headers:noStore});});}
