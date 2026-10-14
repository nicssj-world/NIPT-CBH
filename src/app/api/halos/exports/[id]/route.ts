import {NextResponse,type NextRequest} from 'next/server';
import path from 'node:path';
import {protect} from '../../../../../server/http';
import {p4Error,noStore} from '../../../../../server/p4';
import {withTransaction} from '../../../../../../packages/db/connection';
import {FileStore} from '../../../../../../packages/storage';
import {uuid,need,audit,LabError} from '../../../../../../packages/lab/core';
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{
 const user=await protect(request),{id}=await params;
 const row=await withTransaction(async db=>{need(user,'worksheet.read','read');const row=(await db.query<{file_sha256:string}>('SELECT file_sha256 FROM p4b_halos_export WHERE id=$1',[uuid.parse(id)])).rows[0];if(!row)throw new LabError('NOT_FOUND',404);await audit(db,user,'HALOS_EXPORT_DOWNLOADED','p4b_halos_export',id);return row;});
 const bytes=await new FileStore(path.resolve(process.env.FILE_STORE_ROOT??'data/files')).get(row.file_sha256);
 return new NextResponse(new Uint8Array(bytes),{headers:{...noStore,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="HALOS-Task-Import.xlsx"'}});
}catch(e){return p4Error(e);}}
