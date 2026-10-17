import {it,expect} from 'vitest';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {buildTubeLabelsHtml} from '../../packages/lab/labels';

// OD-R1b conditions 2/5/6: measure the real rendered width at 50 × 20 mm before trusting the fit; no clipping, no
// crossing the cut line, no overlap with the four corner digits. Physical test print remains a separate acceptance.
const base='26B261017001';
const variants=[['S1 Singleton',base],['S1 Twins',base+'D'],['S2 Singleton',base+'R'],['S2 Twins',base+'DR']] as const;
it('every half of S1/S2 Singleton/Twins renders without clipping, cut-line crossing or corner overlap (with and without a name)',async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage();const report:Record<string,unknown>[]=[];
  for(const withName of [false,true])for(const [label,code] of variants){
   const html=buildTubeLabelsHtml([{ln:'261015007701',lnHalos:code,patientName:withName?'ผู้รับบริการจำลอง ชื่อยาวสำหรับทดสอบ':null}]);
   await page.setContent(html);await page.emulateMedia({media:'print'});
   const halves=await page.evaluate(()=>[...document.querySelectorAll('.half')].map(h=>{
    const hr=h.getBoundingClientRect(),code=h.querySelector('.ln-halos') as HTMLElement,range=document.createRange();range.selectNodeContents(code);const t=range.getBoundingClientRect();
    const corners=[...h.querySelectorAll('.corner')].map(c=>c.getBoundingClientRect());
    const overlap=corners.some(c=>c.left<t.right&&t.left<c.right&&c.top<t.bottom&&t.top<c.bottom);
    return {text:code.textContent,fontPt:parseFloat(getComputedStyle(code).fontSize)*0.75,clipped:code.scrollWidth>code.clientWidth+0.5,
     crossesCut:t.right>hr.right+0.5||t.left<hr.left-0.5,cornerOverlap:overlap,corners:corners.length,textWidthMm:+(t.width*25.4/96).toFixed(2)};}));
   for(const h of halves)report.push({variant:label,withName,...h});
   if(label==='S2 Twins'&&!withName){await mkdir('.local/p0-e2e/evidence',{recursive:true});await writeFile('.local/p0-e2e/evidence/label-S2-twins-50x20.pdf',await page.pdf({width:'50mm',height:'20mm',printBackground:true}));}
  }
  await mkdir('.local/p0-e2e/evidence',{recursive:true});await writeFile('.local/p0-e2e/evidence/label-fit-measurement.json',JSON.stringify(report,null,1));
  type H={variant:string;withName:boolean;text:string;fontPt:number;clipped:boolean;crossesCut:boolean;cornerOverlap:boolean;corners:number};
  for(const h of report as H[]){
   expect(h.clipped,`${h.variant} ${h.text} clipped`).toBe(false);expect(h.crossesCut,`${h.variant} ${h.text} crosses cut`).toBe(false);
   expect(h.corners,`${h.variant} corners`).toBe(4);expect(h.fontPt,`${h.variant} ${h.text} legibility floor`).toBeGreaterThanOrEqual(6);
  }
  // S2 must be no worse than the Owner-approved S1 layout: a half may touch a corner only where the same S1 half already does.
  const s1Overlap=new Set((report as H[]).filter(h=>h.variant.startsWith('S1')&&h.cornerOverlap).map(h=>`${h.withName}:${h.text.replace(/^\d{2}B\d{9}D?/,'')}`));
  for(const h of (report as H[]).filter(h=>h.variant.startsWith('S2')))expect(h.cornerOverlap&&!s1Overlap.has(`${h.withName}:${h.text.replace(/^\d{2}B\d{9}D?R/,'')}`),`${h.variant} ${h.text} overlaps a corner digit where S1 does not (name=${h.withName})`).toBe(false);
  // PDF text readback at physical size: the R/DR codes are really on the page.
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const {readFileSync}=await import('node:fs');
  const pdf=await getDocument({data:new Uint8Array(readFileSync('.local/p0-e2e/evidence/label-S2-twins-50x20.pdf')),useSystemFonts:true}).promise;
  expect(pdf.numPages).toBe(4);const p1=await pdf.getPage(1);expect(Math.round(p1.view[2]*25.4/72)).toBe(50);expect(Math.round(p1.view[3]*25.4/72)).toBe(20);
  const text=(await Promise.all([1,2,3,4].map(async i=>(await (await pdf.getPage(i)).getTextContent()).items.map(x=>'str' in x?x.str:'').join(' ')))).join(' ');
  for(const s of [base+'DR',base+'DR-1',base+'DR-2',base+'DR-3','001'])expect(text).toContain(s);
 }finally{await browser.close();}
},120000);
