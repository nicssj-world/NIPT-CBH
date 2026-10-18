import {z} from 'zod';
import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../../../packages/db/connection';
import {ancFormPreview} from '../../../../../../../packages/p2/forms';
import {requestAncOverlay} from '../../../../../../../packages/pdf/anc-overlay';
import {protect} from '../../../../../../server/http';
import {p2Error,noStore} from '../../../../../../server/p2/http';
// ANC "ดูตัวอย่างใบขอส่งตรวจ / ใบยินยอม / เอกสารรวม 2 หน้า": a fresh DRAFT preview from the recorded data and the active template set.
// Read-only: nothing is stored, signed or consented. Print/download only change the Content-Disposition; the bytes are the same draft.
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{
  const user=await protect(request),{id}=await params;
  const kind=z.enum(['request','consent','both']).parse(request.nextUrl.searchParams.get('kind')??'both').toUpperCase() as 'REQUEST'|'CONSENT'|'BOTH';
  const intent=z.enum(['preview','download','print']).parse(request.nextUrl.searchParams.get('intent')??'preview');
  const r=await withTransaction(db=>ancFormPreview(db,user,id,kind,requestAncOverlay));
  return new NextResponse(new Uint8Array(r.bytes),{headers:{...noStore,'Content-Type':'application/pdf','Content-Disposition':`${intent==='download'?'attachment':'inline'}; filename="DRAFT-${kind.toLowerCase()}-preview.pdf"`,
   'X-Content-SHA256':r.hash,'X-Document-Status':'DRAFT_PREVIEW','X-Template-Set':r.templateSet,'X-DCC-Status':r.dccStatus,'X-Consent-Status':r.consentStatus,'X-Missing-Fields':String(r.missing.length)}});
 }catch(e){return p2Error(e);}
}
