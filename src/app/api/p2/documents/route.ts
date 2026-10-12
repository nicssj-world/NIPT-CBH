import {z} from 'zod';
import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../packages/db/connection';
import {createDocumentPreview,readDocumentPreview} from '../../../../../packages/p2/documents';
import {protect,readJson} from '../../../../server/http';
import {p2Error,p2Mutation,noStore} from '../../../../server/p2/http';
export async function POST(request:NextRequest){return p2Mutation(request,'P2_DOCUMENT',async user=>{const input=z.strictObject({caseId:z.uuid(),documentId:z.uuid()}).parse(await readJson(request));return NextResponse.json(await withTransaction(db=>createDocumentPreview(db,user,input.caseId,input.documentId)),{headers:noStore});});}
export async function GET(request:NextRequest){try{const user=await protect(request),id=z.uuid().parse(request.nextUrl.searchParams.get('id')),intent=z.enum(['preview','download','print']).parse(request.nextUrl.searchParams.get('intent'));const r=await withTransaction(db=>readDocumentPreview(db,user,id,intent));return new NextResponse(new Uint8Array(r.bytes),{headers:{...noStore,'Content-Type':'application/pdf','Content-Disposition':`${intent==='download'?'attachment':'inline'}; filename="synthetic-${r.documentId}.pdf"`,'X-Content-SHA256':r.hash}});}catch(e){return p2Error(e);}}
