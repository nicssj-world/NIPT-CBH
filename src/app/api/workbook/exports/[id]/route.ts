import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../../packages/db/connection';
import {downloadWorkbookExport} from '../../../../../../packages/workbook/service';
import {protect} from '../../../../../server/http';
import {noStore} from '../../../../../server/p4';
import {workbookDeps,workbookError} from '../../../../../server/workbook';
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}) {
  try {
    const user=await protect(request),{id}=await params,deps=await workbookDeps(),out=await withTransaction(db=>downloadWorkbookExport(db,user,id,deps));
    return new NextResponse(new Uint8Array(out.bytes),{headers:{...noStore,'Content-Type':out.format==='PDF'?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="task-${id}.${out.format==='PDF'?'pdf':'xlsx'}"`,'X-Document-SHA256':out.file_sha256}});
  }catch(e){return workbookError(e);}
}
