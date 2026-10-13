import {z} from 'zod';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
const short=z.string().max(160),text=z.string().max(1200);
export const f4Schema=z.strictObject({form:z.literal('F4'),synthetic:z.literal(true),clinicalUsable:z.literal(false),
 kind:z.enum(['PRE_WORK','COMPLETED']),preview:z.boolean(),templateVersion:z.literal('SYNTHETIC-F4-v1'),fieldInventory:z.literal('SEED_UNVERIFIED'),
 docId:z.uuid(),poolId:z.uuid(),batchId:z.uuid(),runLabel:short,tubeLabel:short,attempt:z.number().int().positive(),revision:z.literal(1),
 issuedBy:short,issuedAt:short,formulaVersion:short,poolHash:short,holds:z.array(short),plannedBuffer:short,
 rows:z.array(z.strictObject({slot:z.number().int().min(1).max(48),plate:short,kind:z.enum(['PATIENT','PC','NC']),printedId:short,lnHalos:short,concentration:short,planned:short,actual:text.nullable()})).min(1).max(47),
 evidence:z.array(text).max(250),copy:z.strictObject({kind:z.enum(['WORKING_COPY','STATUS_MARKED']),number:z.number().int().positive(),originalHash:short,actor:short,at:short,status:short,reason:text}).nullable()});
export type F4Document=z.infer<typeof f4Schema>;
const e=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function f4Html(input:F4Document){
 const d=f4Schema.parse(input);
 return `<!doctype html><html lang="th"><head><meta charset="utf-8"><style>body{font:11pt Thai,Arial,sans-serif;color:#111}h1{font-size:18pt}.warning{border:3px double #111;padding:8px}table{width:100%;border-collapse:collapse;font-size:9pt}th,td{border:1px solid #555;padding:5px}thead{display:table-header-group}tr{break-inside:avoid}td{height:7mm}.box{display:inline-block;width:5mm;height:5mm;border:1px solid #111}.control{background:#eee}p{overflow-wrap:anywhere}</style></head><body>
 <div class="warning">${d.preview?'ฉบับร่าง — ยังไม่ออกเอกสาร / DRAFT<br>':''}แบบจำลอง F4 — ห้ามใช้ปฏิบัติงานจริง / NOT FOR CLINICAL USE<br>HOLD: ${e(d.holds.join(', '))} · Field inventory: SEED_UNVERIFIED</div>
 ${d.copy?`<p>${e(d.copy.kind)} #${d.copy.number} · ${e(d.copy.status)} · ${e(d.copy.reason)}<br>Original SHA-256 ${e(d.copy.originalHash)} · ${e(d.copy.actor)} / ${e(d.copy.at)}</p>`:''}
 <h1>F4 Pooling / QC2 — ${e(d.kind)}</h1><p>${e(d.tubeLabel)} · Pool ${e(d.poolId)} · Attempt ${d.attempt}</p>
 <p>ค่าที่วางแผน (จำลองเท่านั้น) แยกจากค่าปฏิบัติจริง · Buffer ที่วางแผน ${e(d.plannedBuffer)} µL</p>
 <table><thead><tr><th>ตำแหน่ง / Plate</th><th>ชนิด / Printed Sample ID / LN Halos</th><th>QC1 ng/µL</th><th>แผน µL</th><th>ปฏิบัติจริง</th></tr></thead><tbody>
 ${d.rows.map(r=>`<tr class="${r.kind==='PATIENT'?'':'control'}"><td>${r.slot} / ${e(r.plate)}</td><td>${e(r.kind)}<br>${e(r.printedId)}<br>${e(r.lnHalos)}</td><td>${e(r.concentration)}</td><td>${e(r.planned)}</td><td>${d.kind==='PRE_WORK'?'<span class="box"></span>':e(r.actual)}</td></tr>`).join('')}</tbody></table>
 ${d.kind==='PRE_WORK'?'<p>Buffer ใช้จริง: ____________________<br>QC2: ____________________ Standard 1/2: ____________________<br>ผู้ปฏิบัติ / เวลา / ผู้ทวนสอบ: ________________________________________</p>':d.evidence.map(v=>`<p>${e(v)}</p>`).join('')}
 </body></html>`;
}
export async function renderF4Pdf(input:F4Document){
 const d=f4Schema.parse(input),font=await readFile(path.resolve('node_modules/@fontsource/noto-sans-thai/files/noto-sans-thai-thai-400-normal.woff2'));
 const html=f4Html(d).replace('<style>',`<style>@font-face{font-family:Thai;src:url(data:font/woff2;base64,${font.toString('base64')})}`);
 const browser=await chromium.launch({headless:true,args:process.env.CHROMIUM_NO_SANDBOX==='true'?['--no-sandbox']:[]});
 try{const page=await browser.newPage({javaScriptEnabled:false});await page.route('**/*',r=>r.abort());await page.setContent(html);await page.evaluate(()=>document.fonts.ready);
  const footer=`<div style="font:7px Arial;width:100%;margin:0 10mm">${e(d.runLabel)} · F4 ${e(d.kind)} · ${e(d.docId)} Rev 1 · Pool ${e(d.poolId)} / ${e(d.poolHash)}<br>${e(d.templateVersion)} / ${e(d.formulaVersion)} / SEED_UNVERIFIED · ${e(d.issuedAt)} / ${e(d.issuedBy)} · SYNTHETIC ONLY · <span class="pageNumber"></span>/<span class="totalPages"></span>${d.copy?`<br>${e(d.copy.kind)} #${d.copy.number} / ${e(d.copy.status)} / Original SHA256 ${e(d.copy.originalHash)} / ${e(d.copy.actor)} / ${e(d.copy.at)}`:''}</div>`;
  return await page.pdf({format:'A4',printBackground:true,displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:footer,margin:{top:'10mm',bottom:'22mm',left:'10mm',right:'10mm'}});
 }finally{await browser.close();}
}
export async function requestF4Pdf(doc:F4Document){
 const token=process.env.RENDERER_TOKEN_FILE?(await readFile(process.env.RENDERER_TOKEN_FILE,'utf8')).trim():process.env.RENDERER_TOKEN;
 const url=new URL(process.env.RENDERER_URL||'http://127.0.0.1:3001');
 if(!['127.0.0.1','localhost','renderer'].includes(url.hostname)||url.protocol!=='http:')throw Error('RENDERER_INTERNAL_REQUIRED');
 const r=await fetch(new URL('/render/f4',url),{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(f4Schema.parse(doc)),signal:AbortSignal.timeout(30000),redirect:'error'});
 if(!r.ok||!r.headers.get('content-type')?.startsWith('application/pdf'))throw Error('RENDERER_FAILED');
 const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length>5*1024*1024||!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error('RENDERER_INVALID_PDF');return bytes;
}
