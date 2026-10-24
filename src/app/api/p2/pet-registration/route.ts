import {readFile} from 'node:fs/promises';
import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../packages/db/connection';
import {lookupRegistrationPet,registerFromPet} from '../../../../../packages/p2/pet-registration';
import {readJson} from '../../../../server/http';
import {p2Mutation,noStore} from '../../../../server/p2/http';
import {inboundStore} from '../../../../server/p3/inbound';
export async function POST(request:NextRequest){return p2Mutation(request,'PET_REGISTRATION',async user=>{
 const body=await readJson(request),{action,...input}=body;
 const deps={store:inboundStore(),lookupKey:await readFile(/* turbopackIgnore: true */ process.env.IDENTITY_LOOKUP_KEY_FILE??'')};
 if(action==='lookup')return NextResponse.json(await withTransaction(db=>lookupRegistrationPet(db,user,input,deps)),{headers:noStore});
 if(action==='register')return NextResponse.json(await withTransaction(db=>registerFromPet(db,user,input,deps)),{headers:noStore});
 return NextResponse.json({code:'INVALID_ACTION'},{status:422,headers:noStore});
});}
