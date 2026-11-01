import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../packages/db/connection';
import {ingestMigrationPdfs} from '../../../../../packages/migration/bulk-pdf';
import {need} from '../../../../../packages/lab/core';
import {p5Mutation,noStore,resultStore} from '../../../../server/p5';
import {boundedMultipart} from '../../../../server/bounded-multipart';
const MAX_TOTAL=20*25*1024*1024;
export async function POST(request:NextRequest){return p5Mutation(request,'MIGRATION_BULK_PDF',async user=>{
 need(user,'result.import');
 const form=await boundedMultipart(request,MAX_TOTAL),files=form.getAll('files').filter((x):x is File=>typeof x!=='string');
 const items=await Promise.all(files.map(async file=>({name:file.name,bytes:Buffer.from(await file.arrayBuffer())})));
 if(items.reduce((n,file)=>n+file.bytes.length,0)>MAX_TOTAL)throw Error('UPLOAD_TOO_LARGE');
 return NextResponse.json(await withTransaction(db=>ingestMigrationPdfs(db,user,resultStore(),items)),{headers:noStore});
});}
