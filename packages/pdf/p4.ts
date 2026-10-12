import {z} from 'zod';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
// F2 (Extraction & Library Task List 1–3) and F3 (QC1) worksheets — Plan §12.20, Appendix F.1/F.2/F.4.
// The renderer receives a structured, immutable document snapshot only (never caller HTML) and builds the page itself.
export const P4_TEMPLATE_VERSION='SYNTHETIC-P4-WORKSHEET-v1' as const;
const text=z.string().max(400);
const short=z.string().max(80);
const execEntry=z.strictObject({label:text,value:text,source:z.enum(['PAPER_TRANSCRIPTION','DIRECT_ENTRY']),eventTime:short,recordedAt:short,recordedBy:short,verifiedBy:short});
const transfer=z.strictObject({status:z.enum(['MEASURED','NOT_PERFORMED','EXCLUDED','STOPPED']),text:text,source:short.nullable(),recordedBy:short.nullable(),verifiedBy:short.nullable()});
const f2Row=z.strictObject({slot:z.number().int().min(1).max(48),plate:z.string().regex(/^[A-H][1-6]$/),barcode:z.number().int().min(1).max(48),kind:z.enum(['PATIENT','CONTROL','EMPTY']),control:z.enum(['PC','NC','BLANK']).nullable(),printedId:short,lnHalos:short,round:short,repeat:z.boolean(),transfer:transfer.nullable()});
const qcRow=z.strictObject({slot:z.number().int().min(1).max(48),plate:z.string().regex(/^[A-H][1-6]$/),kind:z.enum(['PATIENT','CONTROL','EMPTY']),control:z.enum(['PC','NC','BLANK']).nullable(),printedId:short,rowStatus:z.enum(['IN_BATCH','NOT_IN_BATCH','NOT_PLACED']),
 result:z.strictObject({value:short.nullable(),decision:short,source:short.nullable(),recordedBy:short.nullable(),verifiedBy:short.nullable()}).nullable()});
const common={docCode:short,revision:z.number().int().min(1),runLabel:z.string().regex(/^Run\d{3,}\/\d{4}$/),templateVersion:z.literal(P4_TEMPLATE_VERSION),fieldInventory:short,
 snapshotRevision:short,issuedAt:short,issuedBy:short,
 copy:z.strictObject({kind:z.enum(['WORKING_COPY','STATUS_MARKED']),copyNumber:z.number().int().min(1).nullable(),originalHash:z.string().regex(/^[a-f0-9]{64}$/),printedBy:short,printedAt:short,status:short.nullable(),statusReason:text.nullable()}).nullable(),
 synthetic:z.literal(true)};
export const p4DocumentSchema=z.discriminatedUnion('form',[
 z.strictObject({form:z.literal('F2'),kind:z.enum(['PRE_WORK','COMPLETED']),...common,sheetNumber:z.number().int().min(1).max(3),strips:z.strictObject({s1:short,s2:short}),controlInstruction:text,
  plan:z.strictObject({workDate:short,operator:short,extractionLot:short,libraryLot:short}),rows:z.array(f2Row).length(16),checklist:z.array(z.strictObject({key:short,label:text})).max(40),execution:z.array(execEntry).max(80),
  startedAt:short.nullable(),pendingGovernance:z.array(short).max(10)}),
 z.strictObject({form:z.literal('F3'),kind:z.enum(['PRE_WORK','COMPLETED']),...common,rows:z.array(qcRow).length(48),standards:z.array(execEntry).max(4),operator:execEntry.nullable(),criteria:z.array(text).max(4),summary:short})
]);
export type P4Document=z.infer<typeof p4DocumentSchema>;
const e=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const DISPOSITION:Record<string,string>={NOT_PERFORMED:'ไม่ได้ทำ',EXCLUDED:'ถอดออก',STOPPED:'หยุด'};
const box='<span class="box" aria-hidden="true"></span>';

/** Pure HTML builder. Pre-work shows only empty boxes/lines for execution data (AT-PREWORK-01/02); Completed shows recorded, verified values with source. */
export function worksheetHtml(doc:P4Document){
 const pre=doc.kind==='PRE_WORK';
 const title=doc.form==='F2'?`NIPT DNA Extraction &amp; Library Preparation Task List ${doc.sheetNumber} (with fragment screening)`:'QC DNA Concentration (QC1 Library)';
 const kindText=pre?'ใบงานก่อนปฏิบัติ (Pre-work) — ยังไม่มีการปฏิบัติ':'บันทึกหลังปฏิบัติ (Completed) — ค่าที่บันทึกจริงและทวนสอบแล้ว';
 let body='';
 if(doc.form==='F2'){
  const rows=doc.rows.map(r=>{
   const id=r.kind==='EMPTY'?'<span class="empty">ว่าง — ไม่มีตัวอย่าง</span>':`<span class="id">${e(r.printedId)}</span>${r.kind==='CONTROL'?` <span class="tag">${e(r.control)}</span>`:''}`;
   const check=r.kind==='EMPTY'?'—':pre?`${box} ก่อน ${box} หลัง`:r.transfer?(r.transfer.status==='MEASURED'?`✓ ก่อน ✓ หลัง<br><small>${e(r.transfer.source)} · ${e(r.transfer.recordedBy)} / ตรวจ ${e(r.transfer.verifiedBy)}</small>`:`${e(DISPOSITION[r.transfer.status])} — ${e(r.transfer.text)}`):'ไม่ได้บันทึก';
   return `<tr class="${r.kind.toLowerCase()}"><td class="pos">${r.slot}<br><small>${e(r.plate)}</small></td><td>${id}${r.kind==='PATIENT'?`<br><small>LN Halos ${e(r.lnHalos)} · ${e(r.round)}${r.repeat?' · Repeat':''}</small>`:''}</td><td class="pos">${r.barcode}</td><td>${check}</td></tr>`;});
  const half=(a:number)=>`<table><thead><tr><th class="pos">ตน. / Plate</th><th>Sample ID (${e(a===0?doc.strips.s1:doc.strips.s2)})</th><th class="pos">Barcode</th><th>✓ ตรวจ Lab number</th></tr></thead><tbody>${rows.slice(a*8,a*8+8).join('')}</tbody></table>`;
  const checklist=doc.checklist.map(c=>`<li>${pre?box:doc.execution.some(x=>x.label===c.label)?'✓':'☐'} ${e(c.label)}</li>`).join('');
  const exec=pre?`<table class="write"><tr><th>วันที่ปฏิบัติงานจริง</th><td></td><th>ผู้ปฏิบัติงานจริง</th><td></td></tr><tr><th>Extraction Lot / Exp. (ใช้จริง)</th><td></td><th>Library Lot / Exp. (ใช้จริง)</th><td></td></tr><tr><th>เวลาเริ่ม Script</th><td></td><th>เวลาจบ Script</th><td></td></tr></table>`
   :`<table><thead><tr><th>รายการ</th><th>ค่า</th><th>ที่มา</th><th>เวลาเหตุการณ์</th><th>เวลากรอก</th><th>ผู้กรอก / ผู้ตรวจ</th></tr></thead><tbody>${doc.execution.map(x=>`<tr><td>${e(x.label)}</td><td>${e(x.value)}</td><td>${x.source==='PAPER_TRANSCRIPTION'?'กระดาษ':'บันทึกตรง'}</td><td>${e(x.eventTime)}</td><td>${e(x.recordedAt)}</td><td>${e(x.recordedBy)} / ${e(x.verifiedBy)}</td></tr>`).join('')}</tbody></table>`;
  body=`<p class="instruction">${e(doc.controlInstruction)}</p><div class="plan"><b>ข้อมูลที่วางแผน (ไม่ใช่ค่าที่ใช้จริง):</b> วันที่ ${e(doc.plan.workDate)} · ผู้ปฏิบัติ ${e(doc.plan.operator)} · Extraction Lot ${e(doc.plan.extractionLot)} · Library Lot ${e(doc.plan.libraryLot)}</div>
   ${doc.pendingGovernance.length?`<p class="pending">ข้อมูลจำลอง: ผ่าน Gate ภายใต้นโยบายจำลองที่ยังรอการตัดสิน (${doc.pendingGovernance.map(e).join(', ')}) — ห้ามใช้ทางคลินิก</p>`:''}
   <h2>แผนผังตัวอย่าง</h2>${half(0)}${half(1)}<h2>บันทึกการปฏิบัติ${pre?' (เขียนระหว่างปฏิบัติงาน)':''}</h2>${!pre&&doc.startedAt?`<p>เริ่มปฏิบัติ (เวลาที่ Server บันทึก): ${e(doc.startedAt)}</p>`:''}${exec}<h2>Checklist ตาม WI-T-BM18</h2><ul class="checklist">${checklist}</ul>`;
 }else{
  const rows=doc.rows.map(r=>{const id=r.rowStatus==='NOT_IN_BATCH'?'ไม่มีใน Batch':r.rowStatus==='NOT_PLACED'?'ยังไม่กำหนดตำแหน่ง':r.kind==='EMPTY'?'ว่าง':`<span class="id">${e(r.printedId)}</span>${r.control?` <span class="tag">${e(r.control)}</span>`:''}`;
   const value=r.rowStatus!=='IN_BATCH'||r.kind==='EMPTY'?'—':pre?'<span class="line"></span>':r.result?(r.result.value!==null?`${e(r.result.value)}<br><small>${e(r.result.source)} · ${e(r.result.recordedBy)} / ตรวจ ${e(r.result.verifiedBy)}</small>`:e(r.result.decision)):'ไม่ได้บันทึก';
   const decision=pre||r.rowStatus!=='IN_BATCH'||r.kind==='EMPTY'?'—':e(r.result?.decision??'ยังไม่ตัดสิน');
   return `<tr class="${r.kind.toLowerCase()}"><td class="pos">${r.slot}<br><small>${e(r.plate)}</small></td><td>${id}</td><td>${value}</td><td>${decision}</td></tr>`;}).join('');
  const std=pre?`<table class="write"><tr><th>Standard 1</th><td></td><th>Standard 2</th><td></td><th>Standard 2 Conc. (ref. 9.9 ng/µL)</th><td></td></tr><tr><th>ผู้ปฏิบัติงาน</th><td colspan="5"></td></tr></table>`
   :`<table><tbody>${[...doc.standards,...(doc.operator?[doc.operator]:[])].map(x=>`<tr><th>${e(x.label)}</th><td>${e(x.value)}</td><td>${x.source==='PAPER_TRANSCRIPTION'?'กระดาษ':'บันทึกตรง'} · ${e(x.recordedBy)} / ตรวจ ${e(x.verifiedBy)}</td></tr>`).join('')}</tbody></table>`;
  body=`<p class="instruction">เตรียมน้ำยา dsDNA (Equalbit 1x dsDNA HS Assay Kit): Standard = Buffer 190 µL + Standard 10 µL · ตัวอย่าง = Buffer 198 µL + Sample 2 µL</p>${std}
   <p class="pending">เกณฑ์ QC1 ยังไม่ได้รับรอง (OD-31 / WC-03) — ระบบไม่ตัดสินผ่าน/ไม่ผ่านอัตโนมัติ: ${doc.criteria.map(e).join(' · ')}</p>${pre?'':`<p><b>สรุป:</b> ${e(doc.summary)}</p>`}
   <table><thead><tr><th class="pos">ตน. / Plate</th><th>Sample ID</th><th>Concentration (ng/µL)</th><th>การตัดสิน Stage QC1</th></tr></thead><tbody>${rows}</tbody></table>`;
 }
 const copy=doc.copy?.kind==='WORKING_COPY'?`<div class="band">สำเนาใช้งานเลขที่ ${doc.copy.copyNumber} — ${e(doc.docCode)} Rev ${doc.revision} — Original SHA-256 ${e(doc.copy.originalHash.slice(0,16))}… — พิมพ์โดย ${e(doc.copy.printedBy)} ${e(doc.copy.printedAt)}</div>`
  :doc.copy?.kind==='STATUS_MARKED'?`<div class="mark">${e(doc.copy.status)} — ${e(doc.copy.statusReason)} — อ่านอ้างอิงเท่านั้น ห้ามใช้ปฏิบัติงาน (Original ${e(doc.copy.originalHash.slice(0,16))}…)</div>`:'';
 return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${e(doc.docCode)}</title><style>
 *{box-sizing:border-box}body{font:10pt Latin,Thai,sans-serif;color:#111;margin:0}h1{font-size:14pt;margin:0 0 2mm}h2{font-size:11pt;margin:4mm 0 2mm}
 .head{display:flex;justify-content:space-between;gap:4mm;border-bottom:1px solid #444;padding-bottom:2mm;margin-bottom:3mm}.synthetic{border:2px solid #111;padding:1mm 3mm;font-weight:700}
 table{width:100%;border-collapse:collapse;margin:0 0 3mm;table-layout:fixed}thead{display:table-header-group}tr{break-inside:avoid}th,td{border:1px solid #666;padding:1.5mm;vertical-align:top;overflow-wrap:anywhere;text-align:left}
 th.pos,td.pos{width:16mm;text-align:center}.id{font-size:12pt;font-weight:700;letter-spacing:.04em}tr.control td{background:#e8e8e8}tr.empty td{color:#555}.tag{border:1px solid #111;padding:0 1.5mm;font-weight:700}
 .box{display:inline-block;width:5mm;height:5mm;border:1px solid #111;vertical-align:middle}.line{display:inline-block;width:30mm;height:7mm;border-bottom:1px solid #111}
 table.write td{height:9mm}.checklist{list-style:none;padding:0;columns:2;margin:0}.checklist li{break-inside:avoid;margin-bottom:1.5mm}
 .plan,.instruction{margin:0 0 2mm}.pending{border:1px dashed #111;padding:1.5mm}.band{border:2px solid #111;padding:1.5mm;margin-bottom:3mm;font-weight:700}
 .mark{border:3px double #111;padding:2mm;margin-bottom:3mm;font-weight:700;font-size:12pt;text-align:center}small{font-size:8pt}
 </style></head><body>${copy}<div class="head"><div><h1>${title}</h1><div>${e(doc.runLabel)} · ${e(kindText)}</div></div><div class="synthetic">ข้อมูลจำลอง — ไม่ใช้ทางคลินิก</div></div>${body}</body></html>`;
}
const footer=(doc:P4Document)=>`<div style="width:100%;margin:0 10mm;font:8px Arial,sans-serif;color:#111;border-top:1px solid #777;padding-top:3px;line-height:11px">${e(doc.runLabel)} · ${e(doc.form)} ${e(doc.kind)} · DocID ${e(doc.docCode)} Rev ${doc.revision} · Template ${e(doc.templateVersion)} · Snapshot ${e(doc.snapshotRevision)} · Field inventory ${e(doc.fieldInventory)}<br>สถานะ ณ ตอนออก: ${e(doc.kind)} · ออกเมื่อ ${e(doc.issuedAt)} โดย ${e(doc.issuedBy)} · SYNTHETIC — NOT FOR CLINICAL USE · หน้า <span class="pageNumber"></span>/<span class="totalPages"></span></div>`;
export async function renderP4Pdf(input:P4Document){
 const doc=p4DocumentSchema.parse(input);
 const font=async(file:string)=>(await readFile(path.resolve(file))).toString('base64');
 const faces=`@font-face{font-family:Thai;src:url(data:font/woff2;base64,${await font('node_modules/@fontsource/noto-sans-thai/files/noto-sans-thai-thai-400-normal.woff2')})}@font-face{font-family:Thai;font-weight:700;src:url(data:font/woff2;base64,${await font('node_modules/@fontsource/noto-sans-thai/files/noto-sans-thai-thai-700-normal.woff2')})}@font-face{font-family:Latin;src:url(data:font/woff2;base64,${await font('node_modules/@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff2')})}@font-face{font-family:Latin;font-weight:700;src:url(data:font/woff2;base64,${await font('node_modules/@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff2')})}`;
 const html=worksheetHtml(doc).replace('<style>',`<style>${faces}`);
 const browser=await chromium.launch({headless:true,args:process.env.CHROMIUM_NO_SANDBOX==='true'?['--no-sandbox']:[]});
 try{const page=await browser.newPage({javaScriptEnabled:false});await page.route('**/*',r=>r.abort());await page.setContent(html,{waitUntil:'load'});await page.evaluate(()=>document.fonts.ready);
  return await page.pdf({format:'A4',landscape:doc.form==='F2',printBackground:true,displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:footer(doc),margin:{top:'10mm',bottom:'18mm',left:'10mm',right:'10mm'}});}
 finally{await browser.close();}
}
export async function requestP4Pdf(input:P4Document){const doc=p4DocumentSchema.parse(input),token=process.env.RENDERER_TOKEN_FILE?(await readFile(process.env.RENDERER_TOKEN_FILE,'utf8')).trim():process.env.RENDERER_TOKEN;if(!token||token.length<32)throw Error('RENDERER_TOKEN_REQUIRED');const url=new URL(process.env.RENDERER_URL||'http://127.0.0.1:3001');if(!['127.0.0.1','localhost','renderer'].includes(url.hostname)||url.protocol!=='http:')throw Error('RENDERER_INTERNAL_REQUIRED');const r=await fetch(new URL('/render/p4',url),{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(doc),signal:AbortSignal.timeout(30000),redirect:'error'});if(!r.ok||!r.headers.get('content-type')?.startsWith('application/pdf'))throw Error('RENDERER_FAILED');const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length>5*1024*1024||!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error('RENDERER_INVALID_PDF');return bytes;}
