import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {PDFDocument} from 'pdf-lib';
import {renderP2Pdf,type P2PdfInput} from '../../packages/pdf/p2';
import {snapshotConsentFields} from '../../packages/pdf/dcc-snapshot';
import {joinPdfs} from '../../packages/pdf/anc-overlay';
import {deriveSignature} from '../../packages/p2/signature';
import {DCC_CONSENT} from '../../packages/forms/consent-content';
import {CONSENT_PAGE,REQUEST_PAGE} from '../../packages/forms/layout';
import {FORM_ASSETS,stageFormAssets,releaseFormEnvironment} from '../../tools/win-installer/form-assets.mjs';
import {sha256Bytes} from '../../tools/win-installer/lib.mjs';

const sig=deriveSignature({width:600,height:200,strokes:[[[40,150],[150,30],[300,140],[560,45]]]});
const frozen={id:FORM_ASSETS.id,requestSha256:FORM_ASSETS.request,consentSha256:FORM_ASSETS.consent,dccStatus:FORM_ASSETS.dccStatus,layout:FORM_ASSETS.layout};
const base=(kind:'REQUEST'|'CONSENT'='CONSENT'):P2PdfInput=>({id:crypto.randomUUID(),kind,templateVersion:kind==='REQUEST'?'CBH-FM01-v1':'CBH-FM02-v1',hash:'a'.repeat(64),generatedAt:'2026-10-19T01:00:00Z',finalConsent:null,
 payload:{synthetic:false,dcc:frozen,identity:{ln:'009900010001',hn:'009900001',roundNumber:1},consentContent:DCC_CONSENT,doctor:{name:'SYNTHETIC doctor',signature_png:sig.png,signature_hash:sig.hash},formFields:kind==='CONSENT'?{patientName:'SYNTHETIC patient',doctor:'SYNTHETIC doctor',acknowledged:Array(12).fill(true),decision:'Granted',patientSignedDate:'01/01/2569'}:
 {name:'SYNTHETIC patient',hn:'009900001',history:Array(7).fill(null),draw:{date:null,time:null},receive:{condition:null,reason:null,date:null,time:null}}}});
const final=()=>({consentContent:DCC_CONSENT,signature:{decision:'Granted',signed_at:'2026-10-19T01:01:00Z',png:sig.png,signature_hash:sig.hash},acknowledgments:DCC_CONSENT.clauses.map((c,i)=>({item:i+1,clauseId:c.id,contentVersion:DCC_CONSENT.id,contentSha256:DCC_CONSENT.sha256,acknowledged_at:'2026-10-19T01:01:00Z'}))});

it('DCC clause ticks require complete final evidence for the exact frozen content',()=>{
 const input=base();expect(snapshotConsentFields(input).acknowledged.some(Boolean)).toBe(false);
 input.finalConsent=final();expect(snapshotConsentFields(input).acknowledged.every(Boolean)).toBe(true);
 expect(snapshotConsentFields(input).patientSignedDate).toBe('19/10/2569');
 input.finalConsent={...final(),acknowledgments:[{item:1}]};expect(snapshotConsentFields(input).decision).toBeNull();
 input.finalConsent={...final(),consentContent:{id:'legacy',sha256:'b'.repeat(64)}};expect(()=>snapshotConsentFields(input)).toThrow('DCC_CONSENT_CONTENT_MISMATCH');
});
it('prints the named legal representative in the DCC signer field when representative signing was recorded',()=>{const input=base();input.payload.representative={name:'SYNTHETIC guardian',relationship:'SYNTHETIC parent',authorityBasis:'SYNTHETIC verified legal basis',authorityConfirmed:true};input.finalConsent=final();expect(snapshotConsentFields(input).patientName).toBe('ผู้แทนโดยชอบธรรม: SYNTHETIC guardian (SYNTHETIC parent)');});

async function inspect(bytes:Buffer){
 const {getDocument,OPS,Util}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const task=getDocument({data:new Uint8Array(bytes),useSystemFonts:true});
 try{
  const doc=await task.promise,page=await doc.getPage(1),ops=await page.getOperatorList();
  let matrix=[1,0,0,1,0,0];const stack:number[][]=[],images:number[][]=[];
  for(let i=0;i<ops.fnArray.length;i++){
   const op=ops.fnArray[i];if(op===OPS.save)stack.push([...matrix]);else if(op===OPS.restore)matrix=stack.pop()??[1,0,0,1,0,0];
   else if(op===OPS.transform)matrix=Util.transform(matrix,ops.argsArray[i]);
   else if(op===OPS.paintImageXObject||op===OPS.paintInlineImageXObject)images.push([...matrix]);
  }
  return {pages:doc.numPages,text:(await page.getTextContent()).items.filter(i=>'str' in i).map(i=>i.str).join(' '),images:images.length,imageMatrices:images};
 }
 finally{await task.destroy();}
}
// Owner originals remain outside Git; explicitly supplied files enable the local rendering evidence.
describe.skipIf(!process.env.NIPT_ANC_REQUEST_PDF||!process.env.NIPT_ANC_CONSENT_PDF)('DCC actual PDF rendering',()=>{
 let root:string;const prior={mode:process.env.NIPT_MODE,origin:process.env.APP_ORIGIN,registry:process.env.NIPT_ANC_FORM_REGISTRY};
 beforeAll(async()=>{root=await mkdtemp(path.join(os.tmpdir(),'nipt-dcc-pdf-'));await stageFormAssets(root,{request:process.env.NIPT_ANC_REQUEST_PDF,consent:process.env.NIPT_ANC_CONSENT_PDF});process.env.NIPT_ANC_FORM_REGISTRY=releaseFormEnvironment(root).NIPT_ANC_FORM_REGISTRY;process.env.NIPT_MODE='operational';process.env.APP_ORIGIN='https://localhost:19992';});
 afterAll(async()=>{await rm(root,{recursive:true,force:true});for(const [key,value] of Object.entries({NIPT_MODE:prior.mode,APP_ORIGIN:prior.origin,NIPT_ANC_FORM_REGISTRY:prior.registry}))if(value===undefined)delete process.env[key];else process.env[key]=value;});
 it('keeps original dimensions and hashes; Request1 + Consent1 join to2; signatures are images on actual originals',async()=>{
  const consent=base();const unsigned=await renderP2Pdf(consent),unsignedInfo=await inspect(unsigned);
  const signed=await renderP2Pdf({...consent,finalConsent:final()}),signedInfo=await inspect(signed);
  expect(unsignedInfo.pages).toBe(1);expect(signedInfo.pages).toBe(1);expect(signedInfo.images).toBe(unsignedInfo.images+1);
  for(const [matrix,minX] of signedInfo.imageMatrices.slice(-2).map((m,i)=>[m,i===0?350:115] as const)){expect(matrix[4]).toBeGreaterThanOrEqual(minX);expect(matrix[4]+matrix[0]).toBeLessThanOrEqual(minX+130);expect(matrix[5]).toBeCloseTo(185,1);expect(matrix[3]).toBeCloseTo(26,1);}
  expect(unsignedInfo.text).toContain('UNSIGNED');expect(signedInfo.text).toContain('DRAFT / DCC NOT APPROVED');expect(signedInfo.text).toContain('signed evidence recorded');
  const request=base('REQUEST'),withDoctor=await renderP2Pdf(request);request.payload.doctor={name:'SYNTHETIC doctor'};
  const noDoctor=await renderP2Pdf(request);expect((await inspect(withDoctor)).images).toBe((await inspect(noDoctor)).images+1);
  for(const [bytes,size] of [[withDoctor,REQUEST_PAGE],[signed,CONSENT_PAGE]] as const){const pdf=await PDFDocument.load(bytes);expect(pdf.getPageCount()).toBe(1);expect(pdf.getPages()[0].getWidth()).toBeCloseTo(size.width,2);expect(pdf.getPages()[0].getHeight()).toBeCloseTo(size.height,2);expect(pdf.getSubject()).toContain(FORM_ASSETS.consent);}
  expect((await PDFDocument.load(await joinPdfs([withDoctor,signed]))).getPageCount()).toBe(2);
  expect(sha256Bytes(await readFile(process.env.NIPT_ANC_REQUEST_PDF!))).toBe(FORM_ASSETS.request);expect(sha256Bytes(await readFile(process.env.NIPT_ANC_CONSENT_PDF!))).toBe(FORM_ASSETS.consent);
 },60000);
 it('refuses a frozen/current template hash mismatch instead of silently using another revision',async()=>{
  const input=base();input.payload.dcc={...frozen,consentSha256:'b'.repeat(64)};await expect(renderP2Pdf(input)).rejects.toThrow('DCC_SNAPSHOT_TEMPLATE_MISMATCH');
 });
});
