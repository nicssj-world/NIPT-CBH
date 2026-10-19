import {z} from 'zod';
import {createHash} from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import {loadTemplates} from '../forms/registry';
import {isCurrentConsent,consentAcknowledged,DCC_CONSENT} from '../forms/consent-content';
import {requestItems,consentItems,REQUEST_PAGE,CONSENT_PAGE,type RequestFields,type ConsentFields} from '../forms/layout';
import {displayBe} from '../domain/thai-date';
import {renderAncOverlay,composeForms} from './anc-overlay';
import type {P2PdfInput} from './p2';

const descriptor=z.strictObject({id:z.string(),requestSha256:z.string().regex(/^[a-f0-9]{64}$/),consentSha256:z.string().regex(/^[a-f0-9]{64}$/),
 dccStatus:z.enum(['REFERENCE_NOT_DCC_APPROVED','DCC_APPROVED']),layout:z.literal('BM17-2026-10')});
const record=(v:unknown)=>v&&typeof v==='object'?v as Record<string,unknown>:{};
/** DCC ticks represent only the exact clause content acknowledged in the completed signing evidence. */
export function snapshotConsentFields(s:P2PdfInput):ConsentFields{
 const frozen=record(s.payload.formFields),final=s.finalConsent,sig=record(final?.signature);
 if(!isCurrentConsent(s.payload.consentContent)||final&&!isCurrentConsent(final.consentContent))throw Error('DCC_CONSENT_CONTENT_MISMATCH');
 const signed=consentAcknowledged(s.payload.consentContent,final)&&typeof sig.png==='string'&&typeof sig.signed_at==='string'&&['Granted','Declined'].includes(String(sig.decision));
 return {patientName:typeof frozen.patientName==='string'?frozen.patientName:null,doctor:typeof frozen.doctor==='string'?frozen.doctor:null,
  acknowledged:DCC_CONSENT.clauses.map(()=>signed),decision:signed?sig.decision as 'Granted'|'Declined':null,
  patientSignedDate:signed?displayBe(new Date(new Date(String(sig.signed_at)).getTime()+7*3600000).toISOString().slice(0,10),''):null};
}
function signatureBytes(value:unknown){
 if(value===null||value===undefined)return null;
 if(typeof value!=='string'||value.length>200000||!/^[A-Za-z0-9+/]+=*$/.test(value))throw Error('DCC_SIGNATURE_INVALID');
 const bytes=Buffer.from(value,'base64');
 if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('DCC_SIGNATURE_INVALID');
 return bytes;
}
/** Locked operational snapshot: unchanged verified original plus recorded fields and signatures. */
export async function renderDccSnapshot(s:P2PdfInput){
 const frozen=descriptor.parse(s.payload.dcc),templates=await loadTemplates(frozen.id),set=templates.set;
 if(frozen.requestSha256!==set.request.sha256||frozen.consentSha256!==set.consent.sha256||frozen.layout!==set.layout)throw Error('DCC_SNAPSHOT_TEMPLATE_MISMATCH');
 const approved=frozen.dccStatus==='DCC_APPROVED'&&set.dccStatus==='DCC_APPROVED';
 const fields=s.kind==='CONSENT'?snapshotConsentFields(s):null;
 const size=s.kind==='REQUEST'?REQUEST_PAGE:CONSENT_PAGE;
 const template=s.kind==='REQUEST'?templates.request:templates.consent;
 const source=await PDFDocument.load(template),page=source.getPages()[0];
 if(source.getPageCount()!==1||Math.abs(page.getWidth()-size.width)>0.1||Math.abs(page.getHeight()-size.height)>0.1)throw Error('DCC_TEMPLATE_PAGE_MISMATCH');
 const identity=record(s.payload.identity);
 const banner=`${approved?'LOCKED SNAPSHOT':'DRAFT / DCC NOT APPROVED'} · ${s.kind} · LN ${identity.ln??''} / HN ${identity.hn??''} · Snapshot ${s.id} · SHA-256 ${s.hash} · ${s.generatedAt} · ${s.kind==='CONSENT'?(fields?.decision?'signed evidence recorded':s.finalConsent?'INCOMPLETE SIGNING EVIDENCE':'UNSIGNED'):''}`;
 const overlays=await renderAncOverlay({pages:[{...size,items:s.kind==='REQUEST'?requestItems(s.payload.formFields as RequestFields):consentItems(fields!),banner,watermark:approved?'':'DRAFT / DCC NOT APPROVED'}]});
 const bytes=await composeForms([{template,overlay:overlays[0],...size}],`${approved?'':'DRAFT '}${s.kind} ${set.id}`);
 const doc=await PDFDocument.load(bytes),out=doc.getPages()[0];
 const draw=async(value:unknown,hash:unknown,x:number,y:number,w:number,h:number)=>{
  const png=signatureBytes(value);if(!png)return;
  if(hash!==undefined&&createHash('sha256').update(png).digest('hex')!==hash)throw Error('DCC_SIGNATURE_HASH_MISMATCH');
  const image=await doc.embedPng(png),scale=Math.min(w/image.width,h/image.height),width=image.width*scale,height=image.height*scale;
  out.drawImage(image,{x:x+(w-width)/2,y:y+(h-height)/2,width,height});
 };
 const doctor=record(s.payload.doctor);
 await draw(doctor.signature_png,doctor.signature_hash,s.kind==='CONSENT'?350:400,s.kind==='CONSENT'?185:586,130,s.kind==='CONSENT'?26:20);
 if(s.kind==='CONSENT'&&fields?.decision){const sig=record(s.finalConsent?.signature);await draw(sig.png,sig.signature_hash,115,185,130,26);}
 doc.setSubject(`Snapshot ${s.id}; SHA-256 ${s.hash}; request ${frozen.requestSha256}; consent ${frozen.consentSha256}; ${approved?'DCC_APPROVED':'REFERENCE_NOT_DCC_APPROVED'}`);
 return Buffer.from(await doc.save());
}
