import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {f5Schema,f5Html,F5_FIELDS,renderF5Pdf,type F5Document} from '../../packages/pdf/f5';
const fixture=():F5Document=>({form:'F5',synthetic:true,clinicalUsable:false,purpose:'SYNTHETIC_SIMULATION',kind:'PRE_WORK',preview:true,
 templateVersion:'SYNTHETIC-F5-v1',fieldInventory:'SEED_UNVERIFIED',docId:randomUUID(),batchId:randomUUID(),dnbId:randomUUID(),
 runLabel:'Run001/2026',dnbLabel:'DNB20261013',revision:1,issuedBy:'ผู้ใช้จำลอง',issuedAt:'2026-10-13T09:00:00.000Z',poolSnapshotId:randomUUID(),poolHash:'a'.repeat(64),evidenceHash:'b'.repeat(64),
 holds:['OD-31','OD-32','OD-33','Q-P4','Q-I8'],fields:F5_FIELDS.map(([id,label])=>({id,label,planned:'ยังไม่อนุมัติ',actual:null})),
 evidence:[],members:[{position:2,role:'PATIENT',printedId:'SYN-F5-002',lnHalos:'SYN-LN-002',barcode:'UNMAPPED'}],copy:null});
it('F5 draft preserves all 17 inventory fields, blank actuals and HOLD; escapes source strings',()=>{
 const d=fixture();d.members[0].printedId='<script>bad</script>';const html=f5Html(d);
 for(const [id] of F5_FIELDS)expect(html).toContain(id);
 expect(html).toContain('NOT FOR CLINICAL USE');expect(html).toContain('DRAFT');expect(html).toContain('Acceptance HOLD');
 expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');expect(html).not.toContain('✓');
});
it('F5 refuses clinical claims, incomplete inventory, duplicate fields and Pre-work actual evidence',()=>{
 const d=fixture();expect(f5Schema.safeParse({...d,clinicalUsable:true}).success).toBe(false);
 expect(f5Schema.safeParse({...d,fields:d.fields.slice(1)}).success).toBe(false);
 expect(f5Schema.safeParse({...d,fields:d.fields.map(()=>d.fields[0])}).success).toBe(false);
 expect(f5Schema.safeParse({...d,fields:d.fields.map(f=>({...f,actual:'fabricated'}))}).success).toBe(false);
});
it('F5 Completed renders actual/source/reviewer and derivative hash separately from immutable original',()=>{
 const d=fixture();d.preview=false;d.kind='COMPLETED';d.fields[0].actual='DIRECT_ENTRY / reviewer SYNTHETIC';
 d.copy={kind:'STATUS_MARKED',number:2,originalHash:'c'.repeat(64),actor:'ผู้ตรวจจำลอง',at:d.issuedAt,status:'STOP_USE',reason:'จำลอง เรียกคืนเอกสาร'};
 const html=f5Html(d);expect(html).toContain('DIRECT_ENTRY / reviewer SYNTHETIC');expect(html).toContain('STATUS_MARKED #2');expect(html).toContain('STOP_USE');expect(html).toContain('c'.repeat(64));expect(html).not.toContain('DRAFT');
});
it('F5 real Chromium PDF includes embedded Thai text, multipage members and repeated traceability footer',async()=>{
 const d=fixture();d.members=Array.from({length:47},(_,i)=>({position:i<39?i+1:i+2,role:i===0?'PC':i===24?'NC':'PATIENT',printedId:'SYN-F5-'+i,lnHalos:'SYN-LN-'+i,barcode:'UNMAPPED'}));
 const bytes=await renderF5Pdf(d);expect(bytes.subarray(0,5).toString()).toBe('%PDF-');
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const task=getDocument({data:new Uint8Array(bytes),useSystemFonts:true});const pdf=await task.promise;
 try{expect(pdf.numPages).toBeGreaterThan(1);let all='';for(let n=1;n<=pdf.numPages;n++){const page=await pdf.getPage(n),content=await page.getTextContent();const text=content.items.map(x=>'str' in x?x.str:'').join(' ');expect(text).toContain('SYNTHETIC ONLY');expect(text).toContain(d.docId);all+=text;}
 expect(all).toContain('SYN-F5-46');expect(all.replace(/\s/g,'')).toContain('ห้ามใช้ปฏิบัติงาน');
 }finally{await task.destroy();}
},60000);
