import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../../../packages/db/connection';
import {replaceRowPdf,BATCH_LIMITS} from '../../../../../../../packages/historical/service';
import {p5hMutation,noStore} from '../../../../../../server/p5h';
import {resultStore} from '../../../../../../server/p5';
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){return p5hMutation(request,'LAB_MANUAL_PDF_REPLACE',async user=>{
 if(Number(request.headers.get('content-length')??0)>BATCH_LIMITS.pdfBytes+1000000)throw Error('UPLOAD_TOO_LARGE');
 const form=await request.formData(),file=form.get('file'),version=Number(form.get('version')),{id}=await params;
 if(!(file instanceof File)||!file.size||file.size>BATCH_LIMITS.pdfBytes)throw Error('NOT_A_PDF');
 const bytes=Buffer.from(await file.arrayBuffer());
 return NextResponse.json(await withTransaction(db=>replaceRowPdf(db,user,resultStore(),id,version,{name:file.name,bytes})),{headers:noStore});
 });}
