import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {f4Html,f4Schema,renderF4Pdf,type F4Document} from '../../packages/pdf/f4';
const document=():F4Document=>({form:'F4',synthetic:true,clinicalUsable:false,kind:'PRE_WORK',preview:false,templateVersion:'SYNTHETIC-F4-v1',fieldInventory:'SEED_UNVERIFIED',
 docId:randomUUID(),poolId:randomUUID(),batchId:randomUUID(),runLabel:'Run001/2026',tubeLabel:'SYNTHETIC-POOL',attempt:1,revision:1,issuedBy:'ผู้ใช้จำลอง',issuedAt:'2026-10-13T00:00:00Z',formulaVersion:'FS03-07-SYNTHETIC-v1',poolHash:'a'.repeat(64),holds:['OD-28','OD-29','OD-30','OD-31'],plannedBuffer:'512.00',
 rows:Array.from({length:48},(_,i)=>i+1).filter(slot=>slot!==40).map(slot=>({slot,plate:`${'ABCDEFGH'[(slot-1)%8]}${Math.floor((slot-1)/8)+1}`,kind:slot===1?'PC':slot===25?'NC':'PATIENT',printedId:'SYNTHETIC-ID-'+slot,lnHalos:'SYNTHETIC-LN-'+slot,concentration:'10',planned:'5.45',actual:null})),evidence:[],copy:null});
it('F4 planned/actual separation, blank pre-work checks and escaped renderer contract',()=>{
 const d=document(),html=f4Html({...d,tubeLabel:'<script>invalid</script>'});expect(html).not.toContain('✓');expect(html).not.toContain('<script>');expect(html).toContain('&lt;script&gt;');expect(html).toContain('SEED_UNVERIFIED');expect(html).toContain('ห้ามใช้ปฏิบัติงานจริง');
 expect(()=>f4Schema.parse({...d,clinicalUsable:true})).toThrow();expect(()=>f4Schema.parse({...d,synthetic:false})).toThrow();expect(f4Html({...d,preview:true})).toContain('DRAFT');
});
it('real Chromium F4 PDF: Thai, physical/control IDs, repeated traceability and derivative hash on every page',async()=>{
 const d=document(),hash='b'.repeat(64),bytes=await renderF4Pdf({...d,copy:{kind:'WORKING_COPY',number:2,originalHash:hash,actor:'SYNTHETIC-STAFF',at:'2026-10-13T01:00:00Z',status:'SYNTHETIC_HOLD',reason:'จำลอง ทดสอบสำเนา'}});
 expect(bytes.subarray(0,5).toString()).toBe('%PDF-');const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const task=getDocument({data:new Uint8Array(bytes),useSystemFonts:true}),pdf=await task.promise;expect(pdf.numPages).toBeGreaterThan(1);
 const pages:string[]=[];for(let n=1;n<=pdf.numPages;n++){const p=await pdf.getPage(n),text=(await p.getTextContent()).items.map(x=>'str' in x?x.str:'').join(' ');pages.push(text);expect(text).toContain(d.docId);expect(text).toContain('FS03-07-SYNTHETIC-v1');expect(text).toContain('SYNTHETIC ONLY');expect(text).toContain(hash);}
 expect(pages.join(' ')).toContain('SYNTHETIC-ID-25');expect(pages.join(' ')).not.toContain('SYNTHETIC-ID-40');await task.destroy();
},60000);
