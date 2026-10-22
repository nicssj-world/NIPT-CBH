import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../../../packages/db/connection';
import {downloadSeqFile} from '../../../../../../../packages/lab/seq-export';
import {protect} from '../../../../../../server/http';
import {workbookDeps,workbookError} from '../../../../../../server/workbook';
import {noStore} from '../../../../../../server/p4';
export async function GET(request:NextRequest,{params}:{params:Promise<{pairId:string;fileId:string}>}){
 try{const user=await protect(request),{pairId,fileId}=await params,deps=await workbookDeps();
  const out=await withTransaction(db=>downloadSeqFile(db,user,pairId,fileId,deps));
  return new NextResponse(new Uint8Array(out.bytes),{headers:{...noStore,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${out.filename}"`,'Content-Length':String(out.bytes.length),'X-Document-SHA256':out.sha256}});
 }catch(e){return workbookError(e);}
}
