import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../../packages/db/connection';
import {workbookWorkspace,saveWorkbookDraft,exportWorkbook} from '../../../../../../packages/workbook/service';
import {protect,readJson} from '../../../../../server/http';
import {noStore,p4Mutation} from '../../../../../server/p4';
import {workbookDeps,workbookError} from '../../../../../server/workbook';
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}) {
  try {const user=await protect(request),{id}=await params,deps=await workbookDeps();return NextResponse.json(await withTransaction(db=>workbookWorkspace(db,user,id,deps)),{headers:noStore});}catch(e){return workbookError(e);}
}
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}) {
  return p4Mutation(request,'TASK_WORKBOOK',async user=>{
    const {id}=await params,{action,...data}=await readJson(request,150000),deps=await workbookDeps(),input={...data,batchId:id};
    if(action==='saveDraft')return NextResponse.json(await withTransaction(db=>saveWorkbookDraft(db,user,input,deps)),{headers:noStore});
    if(action==='export') {
      let out;
      try{out=await withTransaction(db=>exportWorkbook(db,user,input,deps));}catch(error){return workbookError(error);}
      // Serve the committed, hash-verified artifact, independent of renderer buffers.
      const bytes=await deps.store.get(out.sha256);
      return new NextResponse(new Uint8Array(bytes),{headers:{...noStore,'Content-Length':String(bytes.length),'Content-Type':data.format==='PDF'?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="task-${out.id}.${data.format==='PDF'?'pdf':'xlsx'}"`,'X-Document-SHA256':out.sha256,'X-Task-Formula-Errors':String(Array.isArray(out.manifest.formulaErrors)?out.manifest.formulaErrors.length:0)}});
    }
    throw new Error('ACTION_NOT_ALLOWED');
  });
}
