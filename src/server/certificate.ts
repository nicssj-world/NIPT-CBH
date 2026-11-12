import {X509Certificate} from 'node:crypto';

/** HTTPS certificate presented by THIS environment (APP_ORIGIN). Only the public certificate is ever read: the TLS handshake
 *  hands the web process the same DER bytes a browser receives, so no key, PFX, passphrase or file path is involved. */
export type CertificateStatus='VALID'|'EXPIRING_SOON'|'EXPIRED'|'NOT_YET_VALID';
export type CertificateInfo={subject:string;commonName:string|null;issuer:string;validFrom:string;validTo:string;daysLeft:number;sha256:string;type:'SELF_SIGNED'|'CA_ISSUED';status:CertificateStatus;hostname:string;subjectAltName:string|null};
export const EXPIRY_WARNING_DAYS=30;

const flat=(value:string)=>value.split('\n').map(part=>part.trim()).filter(Boolean).join(', ');
const commonName=(value:string)=>/^CN=(.+)$/m.exec(value)?.[1]?.trim()??null;

export function describeCertificate(der:Buffer,hostname:string,now=new Date()):CertificateInfo{
 const cert=new X509Certificate(der);
 const validFrom=new Date(cert.validFrom),validTo=new Date(cert.validTo);
 const daysLeft=Math.floor((validTo.getTime()-now.getTime())/86_400_000);
 const status:CertificateStatus=now<validFrom?'NOT_YET_VALID':now>validTo?'EXPIRED':daysLeft<=EXPIRY_WARNING_DAYS?'EXPIRING_SOON':'VALID';
 const selfSigned=cert.subject===cert.issuer&&cert.verify(cert.publicKey);
 return {subject:flat(cert.subject),commonName:commonName(cert.subject),issuer:flat(cert.issuer),validFrom:validFrom.toISOString(),validTo:validTo.toISOString(),daysLeft,sha256:cert.fingerprint256,type:selfSigned?'SELF_SIGNED':'CA_ISSUED',status,hostname,subjectAltName:cert.subjectAltName??null};
}

/** The certificate the HTTPS listener of this installation serves now. The target comes only from APP_ORIGIN, never from the caller. */
export async function servedCertificate(origin=process.env.APP_ORIGIN):Promise<{der:Buffer;hostname:string}>{
 if(!origin)throw new Error('APP_ORIGIN_NOT_SET');
 let url:URL;try{url=new URL(origin);}catch{throw new Error('APP_ORIGIN_INVALID');}
 if(url.protocol!=='https:')throw new Error('HTTPS_NOT_ENABLED');
 const tls=await import('node:tls');
 return new Promise((resolve,reject)=>{
  const socket=tls.connect({host:url.hostname,port:Number(url.port||443),servername:/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)?undefined:url.hostname,rejectUnauthorized:false,timeout:3000},()=>{
   const raw=socket.getPeerCertificate()?.raw;socket.end();
   if(!raw||!raw.length)reject(new Error('NO_CERTIFICATE'));else resolve({der:Buffer.from(raw),hostname:url.hostname});
  });
  socket.on('timeout',()=>{socket.destroy();reject(new Error('TLS_TIMEOUT'));});
  socket.on('error',()=>reject(new Error('TLS_UNAVAILABLE')));
 });
}
