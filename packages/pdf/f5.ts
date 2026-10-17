import {z} from 'zod';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {displayBeDateTime} from '../domain/thai-date';
const short=z.string().max(200),text=z.string().max(4000);
export const F5_FIELDS=[
 ['F5-01','DNB / DNBSEQ-G50 / Operator / Barcode type'],['F5-02','Pre-clean MGISP-100 / G50'],
 ['F5-03','DNB Preparation — OD-32 / WC-05 pending'],['F5-04','DNB loading preparation'],
 ['F5-05','Qubit working solution — FS-10 / WC-14'],['F5-06','Standard 1 / Standard 2'],
 ['F5-07','QC3 ssDNA / dilution / remeasure — OD-31 pending'],['F5-08','Loading mix — FS-12'],
 ['F5-09','Cartridge preparation / reagent positions'],['F5-10','Lane / DNB ID / recipe / configuration'],
 ['F5-11','Drive D space (GB)'],['F5-12','Pressure (kPa)'],['F5-13','First-cycle metrics'],
 ['F5-14','HALOS manifest / transfer / independent 1:1 review'],['F5-15','Sequencing / Cartridge / Flow cell IDs'],
 ['F5-16','QC4 lane and sample observations'],['F5-17','Wash preparation / expiry / before-after cleaning']
] as const;
export const f5Schema=z.strictObject({form:z.literal('F5'),synthetic:z.literal(true),clinicalUsable:z.literal(false),
 purpose:z.literal('SYNTHETIC_SIMULATION'),kind:z.enum(['PRE_WORK','COMPLETED']),preview:z.boolean(),
 templateVersion:z.literal('SYNTHETIC-F5-v1'),fieldInventory:z.literal('SEED_UNVERIFIED'),
 docId:z.uuid(),batchId:z.uuid(),dnbId:z.uuid(),runLabel:short,dnbLabel:short,revision:z.number().int().positive(),
 issuedBy:short,issuedAt:z.iso.datetime({offset:true}),poolSnapshotId:z.uuid(),poolHash:z.string().regex(/^[a-f0-9]{64}$/),
 evidenceHash:z.string().regex(/^[a-f0-9]{64}$/),holds:z.array(short).min(1),
 fields:z.array(z.strictObject({id:z.enum(F5_FIELDS.map(f=>f[0])),label:short,planned:text,actual:text.nullable()})).length(17),
 evidence:z.array(z.strictObject({fieldId:short,text})).max(500),
 members:z.array(z.strictObject({position:z.number().int().min(1).max(48),role:short,printedId:short,lnHalos:short,barcode:short})).max(47),
 copy:z.strictObject({kind:z.enum(['WORKING_COPY','STATUS_MARKED']),number:z.number().int().positive(),originalHash:z.string().regex(/^[a-f0-9]{64}$/),actor:short,at:short,status:short,reason:text}).nullable()
}).superRefine((d,c)=>{if(new Set(d.fields.map(f=>f.id)).size!==17)c.addIssue({code:'custom',message:'F5_INVENTORY_REQUIRED'});if(d.kind==='PRE_WORK'&&(d.fields.some(f=>f.actual!==null)||d.evidence.length))c.addIssue({code:'custom',message:'PRE_WORK_ACTUALS_FORBIDDEN'});});
export type F5Document=z.infer<typeof f5Schema>;
const e=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function f5Html(input:F5Document){const d=f5Schema.parse(input);return `<!doctype html><html lang="th"><head><meta charset="utf-8"><style>body{font:10pt Thai,Arial,sans-serif;color:#111}h1{font-size:17pt}.warning{border:3px double #111;padding:8px}table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:8pt}.inventory th:nth-child(1){width:25%}.inventory th:nth-child(2){width:27%}.inventory th:nth-child(3){width:48%}.evidence th:first-child{width:12%}.evidence th:last-child{width:88%}th,td{border:1px solid #555;padding:5px;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}p{overflow-wrap:anywhere}.blank{height:12mm}</style></head><body>
 <div class="warning">${d.preview?'ฉบับร่าง — ห้ามใช้ปฏิบัติงาน / DRAFT<br>':''}แบบจำลอง F5 — ห้ามใช้ปฏิบัติงานจริง / NOT FOR CLINICAL USE<br>Acceptance HOLD · ${e(d.holds.join(', '))}<br>Field inventory: SEED_UNVERIFIED</div>
 <h1>F5 DNB &amp; DNBSEQ-G50 Sequencing — ${e(d.kind)}</h1><p>${e(d.runLabel)} / ${e(d.dnbLabel)} / Rev ${d.revision}<br>Pool snapshot ${e(d.poolSnapshotId)} / SHA-256 ${e(d.poolHash)}<br>Evidence SHA-256 ${e(d.evidenceHash)}</p>
 ${d.copy?`<p>${e(d.copy.kind)} #${d.copy.number} / ${e(d.copy.status)} / ${e(d.copy.reason)}<br>Original SHA-256 ${e(d.copy.originalHash)} / ${e(d.copy.actor)} / ${e(d.copy.at)}</p>`:''}
 <table class="inventory"><thead><tr><th>Field / หลักฐาน</th><th>แผน / ที่มา (ยังไม่รับรอง)</th><th>ค่าปฏิบัติ / Source / ผู้ตรวจ</th></tr></thead><tbody>${d.fields.map(f=>`<tr><td>${e(f.id)}<br>${e(f.label)}</td><td>${e(f.planned)}</td><td${d.kind==='PRE_WORK'?' class="blank"':''}>${d.kind==='PRE_WORK'?'':e(f.actual??'ไม่ปรากฏในหลักฐาน')}</td></tr>`).join('')}</tbody></table>
 <h2>HALOS — รายการตรวจสอบจาก Pool snapshot</h2><p>ไม่ใช่ไฟล์ Vendor-compatible; ห้ามอนุมาน Mapping / Column A. Blank physical40 ไม่ใช่ HALOS Barcode13.</p>
 <table><thead><tr><th>Physical</th><th>Role</th><th>Printed ID</th><th>LN Halos</th><th>Barcode provenance</th></tr></thead><tbody>${d.members.map(m=>`<tr><td>${m.position}</td><td>${e(m.role)}</td><td>${e(m.printedId)}</td><td>${e(m.lnHalos)}</td><td>${e(m.barcode)}</td></tr>`).join('')}</tbody></table>
 ${d.evidence.length?`<h2>หลักฐานปฏิบัติ / Source / ผู้ทวนสอบ</h2><table class="evidence"><thead><tr><th>Field</th><th>Actual evidence</th></tr></thead><tbody>${d.evidence.map(v=>`<tr><td>${e(v.fieldId)}</td><td>${e(v.text)}</td></tr>`).join('')}</tbody></table>`:''}</body></html>`;}
export async function renderF5Pdf(input:F5Document){const d=f5Schema.parse(input),font=await readFile(path.resolve('node_modules/@fontsource/noto-sans-thai/files/noto-sans-thai-thai-400-normal.woff2'));
 const html=f5Html(d).replace('<style>',`<style>@font-face{font-family:Thai;src:url(data:font/woff2;base64,${font.toString('base64')})}`);
 const browser=await chromium.launch({headless:true,args:process.env.CHROMIUM_NO_SANDBOX==='true'?['--no-sandbox']:[]});
 try{const page=await browser.newPage({javaScriptEnabled:false});await page.route('**/*',r=>r.abort());await page.setContent(html);await page.evaluate(()=>document.fonts.ready);
 const footer=`<div style="font:7px Arial;width:100%;margin:0 10mm">${e(d.runLabel)} / F5 ${e(d.kind)} / ${e(d.docId)} Rev ${d.revision}<br>${e(d.templateVersion)} / FS-10-v1 / SEED_UNVERIFIED / ${e(displayBeDateTime(d.issuedAt))} / ${e(d.issuedBy)} / SYNTHETIC ONLY / <span class="pageNumber"></span>/<span class="totalPages"></span>${d.copy?`<br>${e(d.copy.kind)} #${d.copy.number} / ${e(d.copy.status)} / Original SHA256 ${e(d.copy.originalHash)} / ${e(d.copy.actor)} / ${e(d.copy.at)}`:''}</div>`;
 return await page.pdf({format:'A4',printBackground:true,displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:footer,margin:{top:'10mm',bottom:'23mm',left:'10mm',right:'10mm'}});
 }finally{await browser.close();}}
export async function requestF5Pdf(input:F5Document){const doc=f5Schema.parse(input),token=process.env.RENDERER_TOKEN_FILE?(await readFile(process.env.RENDERER_TOKEN_FILE,'utf8')).trim():process.env.RENDERER_TOKEN;
 const url=new URL(process.env.RENDERER_URL||'http://127.0.0.1:3001');if(!['127.0.0.1','localhost','renderer'].includes(url.hostname)||url.protocol!=='http:')throw Error('RENDERER_INTERNAL_REQUIRED');
 const r=await fetch(new URL('/render/f5',url),{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(doc),signal:AbortSignal.timeout(30000),redirect:'error'});
 if(!r.ok||!r.headers.get('content-type')?.startsWith('application/pdf'))throw Error('RENDERER_FAILED');const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length>5*1024*1024||!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error('RENDERER_INVALID_PDF');return bytes;}
