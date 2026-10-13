import {it,expect} from 'vitest';
import {chromium} from 'playwright';
import {buildTubeLabelsHtml,tubeLabelStickers} from '../../packages/lab/labels';

it('actual Chromium print keeps eight 60x20mm pages for two samples with exact per-page LN/Halos and suffixes',async()=>{
 const samples=[{ln:'00990001',lnHalos:'26B261013001',patientName:null},{ln:'00990002',lnHalos:'26B261013002',patientName:null}];
 const browser=await chromium.launch({headless:true});let bytes:Buffer;
 try{const page=await browser.newPage({javaScriptEnabled:false});await page.route('**/*',r=>r.abort());
  await page.setContent(buildTubeLabelsHtml(samples));bytes=await page.pdf({preferCSSPageSize:true,printBackground:true});
 }finally{await browser.close();}
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const task=getDocument({data:new Uint8Array(bytes),useSystemFonts:true}),pdf=await task.promise;
 try{
  expect(pdf.numPages).toBe(8);
  for(let n=1;n<=pdf.numPages;n++){
   const page=await pdf.getPage(n),sample=samples[Math.floor((n-1)/4)],other=samples[1-Math.floor((n-1)/4)];
   expect(page.view[2]).toBeCloseTo(60*72/25.4,0);expect(page.view[3]).toBeCloseTo(20*72/25.4,0);
   const text=(await page.getTextContent()).items.flatMap(x=>'str' in x?[x.str]:[]).join(' ');
   const [left,right]=tubeLabelStickers(sample.lnHalos)[(n-1)%4];
   expect(text).toContain(left);expect(text).toContain(right);expect(text.match(new RegExp('LN: '+sample.ln,'g'))).toHaveLength(2);
   expect(text).not.toContain(other.ln);expect(text).not.toContain(other.lnHalos);
  }
 }finally{await task.destroy();}
},60000);
