import {it,expect} from 'vitest';
import {worksheetHtml,renderP4Pdf,p4DocumentSchema,P4_TEMPLATE_VERSION,type P4Document} from '../../packages/pdf/p4';

const rows=Array.from({length:16},(_,i)=>{const slot=i+1;return slot===1?{slot,plate:'A1',barcode:1,kind:'CONTROL' as const,control:'PC' as const,printedId:'26N120261012-1',lnHalos:'',round:'',repeat:false,transfer:null}
 :slot<=3?{slot,plate:`${'ABCDEFGH'[(slot-1)%8]}1`,barcode:slot,kind:'PATIENT' as const,control:null,printedId:`26B26101200${slot}-1`,lnHalos:`26B26101200${slot}`,round:'รอบที่ 1',repeat:false,transfer:null}
 :{slot,plate:`${'ABCDEFGH'[(slot-1)%8]}${Math.floor((slot-1)/8)+1}`,barcode:slot,kind:'EMPTY' as const,control:null,printedId:'',lnHalos:'',round:'',repeat:false,transfer:null};});
const base={docCode:'F2-RUN001-2026-TL1',revision:1,runLabel:'Run001/2026',templateVersion:P4_TEMPLATE_VERSION as typeof P4_TEMPLATE_VERSION,fieldInventory:'SEED_UNVERIFIED_F4',snapshotRevision:'Placement r1 abc',issuedAt:'12/10/2569 10:00:00',issuedBy:'ผู้ใช้จำลอง lab',copy:null,synthetic:true as const};
const pre:Extract<P4Document,{form:'F2'}>={form:'F2',kind:'PRE_WORK',...base,sheetNumber:1,strips:{s1:'Run001 S1-1/3',s2:'Run001 S2-1/3'},controlInstruction:'แบ่งตัวอย่าง 200 µL ลง Strip Plate ตามตำแหน่ง / ตำแหน่ง 1 (PC) ใส่ MilliQ',plan:{workDate:'2026-10-12',operator:'—',extractionLot:'—',libraryLot:'—'},
 rows,checklist:[{key:'F2-15',label:'เปิดเครื่อง MGISP-100 และ Pre-clean'}],execution:[],startedAt:null,pendingGovernance:['OD-08:CLINICAL_RULES_NOT_APPROVED']};

it('AT-PREWORK-01/02: F2 Pre-work has positions, IDs, control code and only empty boxes — no ✓, Lot or time of execution',()=>{
 const html=worksheetHtml(p4DocumentSchema.parse(pre));
 expect(html).toContain('26N120261012-1');expect(html).toContain('26B261012002-1');expect(html).toContain('Run001 S1-1/3');expect(html).toContain('ว่าง — ไม่มีตัวอย่าง');
 expect(html).toContain('ใบงานก่อนปฏิบัติ (Pre-work)');expect(html).not.toContain('✓ ก่อน');expect(html.match(/class="box"/g)!.length).toBeGreaterThanOrEqual(7);
 expect(html).toContain('ข้อมูลที่วางแผน (ไม่ใช่ค่าที่ใช้จริง)');expect(html).toContain('OD-08:CLINICAL_RULES_NOT_APPROVED');
 expect(html).not.toMatch(/<script|<img|https?:\/\//);
});
it('Completed shows only recorded values with source and disposition text; working copy and status marks are derivatives',()=>{
 const done:Extract<P4Document,{form:'F2'}>={...pre,kind:'COMPLETED',startedAt:'12/10/2569 10:05:00',rows:rows.map(r=>r.slot===2?{...r,transfer:{status:'MEASURED',text:'✓',source:'บันทึกตรง',recordedBy:'ก',verifiedBy:'ข'}}:r.slot===3?{...r,transfer:{status:'STOPPED',text:'REDRAW_ORDERED คำสั่งเก็บตัวอย่างใหม่',source:null,recordedBy:null,verifiedBy:null}}:r),
  execution:[{label:'ผู้ปฏิบัติงานจริง',value:'จำลอง',source:'PAPER_TRANSCRIPTION',eventTime:'ไม่ได้บันทึกบนเอกสาร',recordedAt:'12/10/2569 12:00:00',recordedBy:'ก',verifiedBy:'ข'}]};
 const html=worksheetHtml(p4DocumentSchema.parse(done));
 expect(html).toContain('✓ ก่อน ✓ หลัง');expect(html).toContain('หยุด — REDRAW_ORDERED');expect(html).toContain('ไม่ได้บันทึกบนเอกสาร');expect(html).toContain('กระดาษ');
 expect(worksheetHtml({...pre,copy:{kind:'WORKING_COPY',copyNumber:2,originalHash:'a'.repeat(64),printedBy:'ก',printedAt:'now',status:null,statusReason:null}})).toContain('สำเนาใช้งานเลขที่ 2');
 expect(worksheetHtml({...pre,copy:{kind:'STATUS_MARKED',copyNumber:null,originalHash:'a'.repeat(64),printedBy:'ก',printedAt:'now',status:'ระงับใช้',statusReason:'จำลอง แก้แผน'}})).toContain('ห้ามใช้ปฏิบัติงาน');
 expect(()=>p4DocumentSchema.parse({...pre,rows:rows.slice(0,15)})).toThrow();
});
it('F3 rows not in the batch carry no numbers and criteria are shown as unapproved',()=>{
 const f3:P4Document={form:'F3',kind:'PRE_WORK',...base,docCode:'F3-RUN001-2026',rows:Array.from({length:48},(_,i)=>({slot:i+1,plate:`${'ABCDEFGH'[i%8]}${Math.floor(i/8)+1}`,kind:i===0?'CONTROL' as const:'EMPTY' as const,control:i===0?'PC' as const:null,printedId:i===0?'26N120261012-1':'',rowStatus:i<16?'IN_BATCH' as const:'NOT_IN_BATCH' as const,result:null})),standards:[],operator:null,criteria:['WI 3–50','Workbook ≥2 / ≤0.6'],summary:''};
 const html=worksheetHtml(p4DocumentSchema.parse(f3));
 expect(html.match(/ไม่มีใน Batch/g)).toHaveLength(32);expect(html).toContain('เกณฑ์ QC1 ยังไม่ได้รับรอง (OD-31 / WC-03)');expect(html).toContain('ref. 9.9 ng/µL');
});
it('renders a landscape A4 Thai PDF through Chromium without network access',async()=>{
 const bytes=await renderP4Pdf(pre);expect(bytes.subarray(0,5).toString()).toBe('%PDF-');
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const pdf=await getDocument({data:new Uint8Array(bytes),useSystemFonts:true}).promise;const page=await pdf.getPage(1);
 expect(page.view[2]).toBeGreaterThan(841);expect(page.view[2]).toBeLessThan(844);expect(page.view[3]).toBeGreaterThan(594);expect(page.view[3]).toBeLessThan(597);
 const text=(await page.getTextContent()).items.map(x=>'str' in x?x.str:'').join(' ');
 expect(text).toContain('26B261012002-1');expect(text).toContain('F2-RUN001-2026-TL1');expect(text).toContain('SYNTHETIC');
},60000);
