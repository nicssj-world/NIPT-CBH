import {NextResponse,type NextRequest} from 'next/server';
import {apiError,protect} from '../../../../../server/http';
import {servedCertificate} from '../../../../../server/certificate';

/** APP_ADMIN only. Streams the PUBLIC certificate (DER .cer) this environment currently serves. No input is accepted, so no path can be chosen. */
export async function GET(request:NextRequest){
 try{
  await protect(request,'settings.read');
  const {der}=await servedCertificate();
  return new NextResponse(new Uint8Array(der),{headers:{'Content-Type':'application/pkix-cert','Content-Disposition':'attachment; filename="nipt-cbh-certificate.cer"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 }catch(error){
  const code=error instanceof Error?error.message:'';
  if(['APP_ORIGIN_NOT_SET','APP_ORIGIN_INVALID','HTTPS_NOT_ENABLED','NO_CERTIFICATE','TLS_TIMEOUT','TLS_UNAVAILABLE'].includes(code))return NextResponse.json({error:'ไม่พบใบรับรอง HTTPS ที่ระบบใช้งานอยู่'},{status:404,headers:{'Cache-Control':'no-store'}});
  return apiError(error);
 }
}
