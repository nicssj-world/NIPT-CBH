import {NextResponse,type NextRequest} from 'next/server';
import {apiError,protect} from '../../../../server/http';
import {describeCertificate,servedCertificate} from '../../../../server/certificate';

const headers={'Cache-Control':'no-store'};
/** APP_ADMIN only (settings.read). Read-only: reports the certificate this environment serves; changes nothing. */
export async function GET(request:NextRequest){
 try{
  await protect(request,'settings.read');
  const {der,hostname}=await servedCertificate();
  return NextResponse.json({certificate:describeCertificate(der,hostname)},{headers});
 }catch(error){
  const code=error instanceof Error?error.message:'';
  if(['APP_ORIGIN_NOT_SET','APP_ORIGIN_INVALID','HTTPS_NOT_ENABLED','NO_CERTIFICATE','TLS_TIMEOUT','TLS_UNAVAILABLE'].includes(code))return NextResponse.json({certificate:null,reason:code},{headers});
  return apiError(error);
 }
}
