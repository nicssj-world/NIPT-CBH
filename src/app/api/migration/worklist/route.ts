import {NextResponse,type NextRequest} from 'next/server';
import {protect,readJson} from '../../../../server/http';
import {p5Error,noStore} from '../../../../server/p5';
import {withTransaction} from '../../../../../packages/db/connection';
import {migrationWorklist} from '../../../../../packages/migration/worklist';
import {removePendingImport} from '../../../../../packages/migration/remove-pending';
export async function GET(request:NextRequest){try{const user=await protect(request,'worksheet.read');return NextResponse.json(await withTransaction(db=>migrationWorklist(db,user)),{headers:noStore});}catch(e){return p5Error(e);}}
export async function POST(request:NextRequest){try{const user=await protect(request,'worksheet.revise');const data=await readJson(request);return NextResponse.json(await withTransaction(db=>removePendingImport(db,user,{recordId:data.recordId})),{headers:noStore});}catch(e){return p5Error(e);}}
