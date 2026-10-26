import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {renderP2Pdf,type P2PdfInput} from '../../packages/pdf/p2';
import {deriveSignature} from '../../packages/p2/signature';
import {DCC_CONSENT} from '../../packages/forms/consent-content';
import {joinPdfs} from '../../packages/pdf/anc-overlay';
import {rasterizePdf} from '../forms/rasterize';
import {PDFDocument} from 'pdf-lib';
process.env.NIPT_MODE='operational';process.env.APP_ORIGIN='https://127.0.0.1:20128';process.env.NIPT_ANC_FORM_REGISTRY=path.resolve('.local/task3-uat/forms/registry.json');
const out='docs/anc-owner-uat-20261025/pdf-evidence';await mkdir(out,{recursive:true});
const registry=JSON.parse(await readFile(process.env.NIPT_ANC_FORM_REGISTRY,'utf8')).sets[0];
const dcc={id:registry.id,requestSha256:registry.request.sha256,consentSha256:registry.consent.sha256,dccStatus:registry.dccStatus,layout:registry.layout};
// Generated signature strokes belong only to this isolated rendering test; not a patient/account/legal signature.
const sig=deriveSignature({width:600,height:200,strokes:[[[40,150],[150,30],[300,140],[560,45]]]});
const results:unknown[]=[];
for(const variant of ['unsigned','signed-long-name']){
 const signed=variant==='signed-long-name';
 const payload={synthetic:false,dcc,consentSignatureLayout:'balanced-20261025',identity:{ln:'009900010001',hn:'009900001',roundNumber:1},consentContent:DCC_CONSENT,doctor:{name:'แพทย์จำลอง ชื่อยาวเพื่อทดสอบการจัดสัดส่วน',signature_png:sig.png,signature_hash:sig.hash},formFields:{patientName:signed?'ผู้รับบริการจำลอง ชื่อยาวเพื่อทดสอบการจัดวางลายเซ็นสองคอลัมน์':'ผู้รับบริการจำลอง',doctor:'แพทย์จำลอง ชื่อยาวเพื่อทดสอบการจัดสัดส่วน',acknowledged:Array(12).fill(false),decision:null,patientSignedDate:null}};
 const finalConsent=signed?{consentContent:DCC_CONSENT,signature:{decision:'Granted',signed_at:'2026-10-25T05:00:00Z',png:sig.png,signature_hash:sig.hash},acknowledgments:DCC_CONSENT.clauses.map((c,i)=>({item:i+1,clauseId:c.id,contentVersion:DCC_CONSENT.id,contentSha256:DCC_CONSENT.sha256,acknowledged_at:'2026-10-25T04:59:00Z'}))}:null;
 const input:P2PdfInput={id:crypto.randomUUID(),kind:'CONSENT',templateVersion:'CBH-FM02-v1',hash:'a'.repeat(64),documentCreatedAt:'2026-10-25T04:58:00Z',generatedAt:'2026-10-25T05:01:00Z',payload,finalConsent};
 const consent=await renderP2Pdf(input);const request=await readFile(`${out}/request.pdf`);const combined=await joinPdfs([request,consent]);await writeFile(`${out}/fixture-${variant}-2pages.pdf`,combined);const images=await rasterizePdf(combined,1.5);await writeFile(`${out}/fixture-${variant}-signature.png`,images[1]);const doc=await PDFDocument.load(combined);results.push({variant,pages:doc.getPageCount(),signatureFixtureOnly:true,dccOriginalUnchanged:true});
}
await writeFile(`${out}/signature-fixtures.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
