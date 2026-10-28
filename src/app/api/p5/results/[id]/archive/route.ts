import {NextResponse,type NextRequest} from 'next/server';
import {pool} from '../../../../../../../packages/db/connection';
import {protect} from '../../../../../../server/http';
import {p5Error} from '../../../../../../server/p5';
import {readArchiveStatus} from '../../../../../../../packages/results/archive-access';
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{
  const user=await protect(request),{id}=await params;
  return NextResponse.json(await readArchiveStatus(pool(),user,id),{headers:{'Cache-Control':'no-store'}});
 }catch(error){return p5Error(error);}
}
