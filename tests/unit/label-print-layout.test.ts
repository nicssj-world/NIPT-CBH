import {it,expect} from 'vitest';
import {chromium} from 'playwright';
import {PDFDocument} from 'pdf-lib';
import {buildTubeLabelsHtml} from '../../packages/lab/labels';
it('normal/twin/resampling base labels retain 32 vertical marks, safe half geometry and real 50x20mm PDF pages',async()=>{
 const samples=['26B261012001','26B261012002D','26B261012003','26B261012004D'].map((lnHalos,i)=>({lnHalos,ln:i===3?'0'.repeat(24):'0000000'+i,patientName:null,printedSampleId:lnHalos+(i>1?'R':'-1')}));
 const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();await page.setContent(buildTubeLabelsHtml(samples));await page.emulateMedia({media:'print'});
 const facts=await page.locator('.half').evaluateAll(halves=>halves.map(h=>{
  const rect=(e:Element)=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
  return {overflow:[...h.querySelectorAll('.ln-halos,.patient-ln')].some(e=>e.scrollWidth>e.clientWidth+1),half:rect(h),corners:[...h.querySelectorAll('.corner')].map(e=>({text:e.textContent,rect:rect(e)})),main:[...h.querySelectorAll('.ln-halos,.patient-ln')].map(rect)};
 }));expect(facts).toHaveLength(32);
 for(const [i,f]of facts.entries()){expect(f.half.width).toBeCloseTo(25*96/25.4,0);expect(f.half.height).toBeCloseTo(20*96/25.4,0);expect(f.corners).toHaveLength(4);expect(f.overflow).toBe(false);
  for(const c of f.corners){expect(c.text).toBe(String(Math.floor(i/8)+1).padStart(3,'0'));expect(c.rect.left).toBeGreaterThanOrEqual(f.half.left);expect(c.rect.right).toBeLessThanOrEqual(f.half.right+.01);expect(c.rect.top).toBeGreaterThanOrEqual(f.half.top);expect(c.rect.bottom).toBeLessThanOrEqual(f.half.bottom+.01);
   for(const m of f.main)expect(c.rect.left<m.right&&c.rect.right>m.left&&c.rect.top<m.bottom&&c.rect.bottom>m.top).toBe(false);
  }
 }
 const pdf=await PDFDocument.load(await page.pdf({preferCSSPageSize:true}));expect(pdf.getPageCount()).toBe(16);for(const p of pdf.getPages()){expect(p.getWidth()).toBeCloseTo(50*72/25.4,0);expect(p.getHeight()).toBeCloseTo(20*72/25.4,0);}
 expect(buildTubeLabelsHtml([{ln:'1',lnHalos:'invalid',patientName:null}])).not.toContain('class="corner-set"');
 }finally{await browser.close();}
},30000);
