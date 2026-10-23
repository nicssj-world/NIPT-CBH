import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../packages/db/connection';
import {storageSearch,storageCommand,storageLabel} from '../../../../packages/lab/sample-storage';
import {protect,readJson} from '../../../server/http';
import {p5hError,p5hMutation,noStore} from '../../../server/p5h';
export async function GET(request:NextRequest){try{const user=await protect(request,'worksheet.read',{},'read'),q=request.nextUrl.searchParams;
 if(q.has('label')){const bytes=await withTransaction(db=>storageLabel(db,user,q.get('label')!));return new NextResponse(new Uint8Array(bytes),{headers:{...noStore,'Content-Type':'application/pdf','Content-Disposition':'inline; filename="box-label.pdf"'}});}
 return NextResponse.json(await withTransaction(db=>storageSearch(db,user,Object.fromEntries(q))),{headers:noStore});
}catch(e){return p5hError(e);}}
export async function POST(request:NextRequest){return p5hMutation(request,'LAB_STORAGE',async user=>NextResponse.json(await withTransaction(async db=>storageCommand(db,user,await readJson(request))),{headers:noStore}));}
