import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fillReport,type ReportValues} from '../../packages/readygen/docx';
import {renderDocxBatch} from '../../packages/readygen/native-word';
import {readArchive,writeArchive} from '../../packages/workbook/archive';
import {syntheticSignaturePng} from '../helpers/signature-png';

// Golden layout: the filled report must keep every static label of the Owner master exactly where Word places it in the master itself,
// stay on one A4 page, and (Singleton) match the real ReadyGen-produced reference PDF's layout. Microsoft Word renders all PDFs.
const SRC=path.resolve('.local/task3-sources'),EVIDENCE=path.resolve('.local/task3-evidence/golden');
const ANCHORS=['NON-INVASIVE PRENATAL TESTING REPORT','PATIENT INFORMATION','SAMPLE INFORMATION','Patient Name:','Gestational Age:','Lab No. (LN):','HN:','Sample Collection Date:','ID/Passport:','DOB:','Sample Received Date:',
 'Referring Doctor:','Sample Type:','Hospital/Clinic:','Referral reason:','Remark:','RESULTS','TRISOMY 21','TRISOMY 18','TRISOMY 13','Comment:','ABOUT THE TEST:','CONDITION','SENSITIVITY','REFERENCE','Performance Only for Reference'];
const SINGLETON_ONLY=['Fetal Gender','SEX CHROMOSOME ANEUPLOIDIES','XO','XXX','XXY','XYY'],TWIN_ONLY=['Y Chromosome'];
type Item={str:string;x:number;y:number};
async function items(pdf:Buffer){
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const task=getDocument({data:new Uint8Array(pdf),disableFontFace:true,useSystemFonts:false,verbosity:0}),doc=await task.promise;
 try{const page=await doc.getPage(1),vp=page.getViewport({scale:1}),c=await page.getTextContent();
  return {pages:doc.numPages,width:vp.width,height:vp.height,items:c.items.flatMap(i=>'str' in i&&i.str.trim()?[{str:i.str.replace(/\s+/g,' ').trim(),x:i.transform[4],y:i.transform[5]}]:[]) as Item[]};}finally{await task.destroy();}
}
// The first text item that begins the anchor (Word may split a label into runs; the first run fixes its position).
const locate=(list:Item[],anchor:string)=>list.find(i=>i.str===anchor)??list.find(i=>anchor.startsWith(i.str)&&i.str.length>=Math.min(4,anchor.length)&&list.some(j=>j!==i&&Math.abs(j.y-i.y)<1&&(i.str+j.str).replace(/\s/g,'').startsWith(anchor.replace(/\s/g,'').slice(0,i.str.replace(/\s/g,'').length+1))))??list.find(i=>i.str.startsWith(anchor));
const values=(name:string):ReportValues=>({patientName:name,ga:'17W 6D',sampleID:'99B990101001-1',hn:'99000001',collectDate_cbh:'20-Oct-2026',patientIDCard:'0000000000000',dob_cbh:'01-Jan-1990',receivedDate_cbh:'20-Oct-2026',
 referringPhysician:'SYNTHETIC REFERRING DOCTOR',hospitalName:'Chonburi hospital',remarks:'',sampleType:'Peripheral Blood',qc:'PASS',trisomy21_ra:'High Risk',trisomy18_ra:'Low Risk',trisomy13_ra:'Low Risk',
 risk21:'1/1.01',risk18:'1/2143998259',risk13:'1/39594481',gender:'Male',gender_cbh:'Detected',XO_NEW:'Not Detected',XXX_NEW:'Not Detected',XXY_NEW:'Not Detected',XYY_NEW:'Not Detected',fetalFaction_2:'14.70'});
const signers=(long:boolean)=>({reported:{name:long?'Synthetic Reporter With A Long Legal Name':'Synthetic Reporter',license:'99001',date:'24-Oct-2026',signature:{bytes:syntheticSignaturePng(1),media:'image/png' as const}},
 approved:{name:long?'Synthetic Approver With Long Name':'Synthetic Approver',license:'99002',date:'25-Oct-2026',signature:{bytes:syntheticSignaturePng(2),media:'image/png' as const}}});
/** The unfilled master with its own static signature pictures removed, so the baseline never renders a real signature. */
function maskedMaster(bytes:Buffer){const parts=readArchive(bytes);for(const k of [...parts.keys()])if(/^word\/media\/(image[12]\.(png|jpe?g)|hdphoto1\.wdp)$/.test(k))parts.set(k,k.endsWith('.wdp')?parts.get(k)!:syntheticSignaturePng(9));return writeArchive(parts);}

describe('Task 3 report golden layout (Microsoft Word, protected local masters)',()=>{
 it('Singleton and Twin: static layout identical to the master, one A4 page, long Thai/English names fitted, nothing overflows',async()=>{
  await mkdir(EVIDENCE,{recursive:true});const out:Record<string,unknown>={};
  for(const [kind,file] of [['SINGLETON','singleton.docx'],['TWIN','twin.docx']] as const){
   const master=readFileSync(path.join(SRC,file));
   const longThai='นางสาวกาญจนาภรณ์ศรีสุวรรณวงศ์ ประเสริฐสุขทดสอบนามสกุลยาว';
   // Over the fit floor the master's cell would clip: refused (HOLD/ERROR), never printed truncated.
   expect(()=>fillReport(master,kind,values('นางสาว'+'ก'.repeat(70)),signers(false))).toThrow('PATIENT_NAME_TOO_LONG_FOR_TEMPLATE');
   const filled=[fillReport(master,kind,values('นางสาวจำลอง ทดสอบระบบ'),signers(false)),fillReport(master,kind,values(longThai),signers(true))];
   const pdfs=await renderDocxBatch([{id:'master',docx:maskedMaster(master)},{id:'short',docx:filled[0].bytes},{id:'long',docx:filled[1].bytes}]);
   const [m,s,l]=await Promise.all(pdfs.map(p=>items(p.bytes)));
   for(const p of [m,s,l]){expect(p.pages).toBe(1);expect(Math.abs(p.width-595.3)).toBeLessThan(1);expect(Math.abs(p.height-841.9)).toBeLessThan(1);}
   const anchors=[...ANCHORS,...(kind==='SINGLETON'?SINGLETON_ONLY:TWIN_ONLY)],deltas:Record<string,number>={};
   for(const a of anchors){const base=locate(m.items,a);expect(base,`${kind} master anchor ${a}`).toBeTruthy();
    for(const [label,doc] of [['short',s],['long',l]] as const){const got=locate(doc.items,a);expect(got,`${kind}/${label} anchor ${a}`).toBeTruthy();
     const d=Math.max(Math.abs(got!.x-base!.x),Math.abs(got!.y-base!.y));deltas[`${label}:${a}`]=Number(d.toFixed(2));expect(d,`${kind}/${label} ${a} moved ${d}pt`).toBeLessThanOrEqual(1);}}
   // Every bound value is present, including the full long names; both dates and both signer lines are visible.
   const text=(d:typeof s)=>d.items.map(i=>i.str).join(' ').replace(/\s*-\s*/g,'-');
   // PDF text extraction drops Thai combining marks of some glyphs (e.g. SARA AM): compare base letters on both sides.
   const thai=(v:string)=>v.normalize('NFKD').replace(/[ัิ-ฺ็-๎]/g,'').replace(/ำ/g,'า').replace(/\s+/g,'');
   for(const [doc,name,sig] of [[s,'นางสาวจำลอง ทดสอบระบบ',signers(false)],[l,longThai,signers(true)]] as const){const t=text(doc).replace(/\s+/g,'');
    expect(thai(t)).toContain(thai(name));expect(t).toContain('ReportedDate:24-Oct-2026');expect(t).toContain('ApprovedDate:25-Oct-2026');
    expect(t).toContain(`(${sig.reported.name})`.replace(/\s+/g,''));expect(t).toContain(`(${sig.approved.name})`.replace(/\s+/g,''));}
   for(const p of pdfs)await writeFile(path.join(EVIDENCE,`${kind.toLowerCase()}-${p.id}.pdf`),p.bytes);
   out[kind]={pages:[m.pages,s.pages,l.pages],maxAnchorDeltaPt:Math.max(...Object.values(deltas)),anchors:anchors.length,fontFit:filled[1].bindings.filter(b=>b.token.endsWith('fontRatio'))};
  }
  await writeFile(path.join(EVIDENCE,'golden-layout.json'),JSON.stringify(out,null,2));
 },300000);
 it('Singleton layout matches the real ReadyGen-produced reference PDF (static anchors within 3 pt); differences are recorded',async()=>{
  const master=readFileSync(path.join(SRC,'singleton.docx')),ref=await items(readFileSync(path.join(SRC,'reference-singleton.pdf')));
  const [pdf]=await renderDocxBatch([{id:'gen',docx:fillReport(master,'SINGLETON',values('นางสาวจำลอง ทดสอบระบบ'),signers(false)).bytes}]);const gen=await items(pdf.bytes);
  // ReadyGen's PDF engine and Word place the whole page with a small uniform offset; layout is compared after removing it.
  const pairs=[...ANCHORS,...SINGLETON_ONLY].map(a=>({anchor:a,r:locate(ref.items,a),g:locate(gen.items,a)}));
  const med=(v:number[])=>{const s=[...v].sort((x,y)=>x-y);return s[Math.floor(s.length/2)];};
  const both=pairs.filter(p=>p.r&&p.g),offset={dx:med(both.map(p=>p.g!.x-p.r!.x)),dy:med(both.map(p=>p.g!.y-p.r!.y))};
  const rows=pairs.map(p=>({anchor:p.anchor,inReference:!!p.r,inGenerated:!!p.g,rawDeltaPt:p.r&&p.g?Number(Math.max(Math.abs(p.r.x-p.g.x),Math.abs(p.r.y-p.g.y)).toFixed(2)):null,
   residualPt:p.r&&p.g?Number(Math.max(Math.abs(p.g.x-p.r.x-offset.dx),Math.abs(p.g.y-p.r.y-offset.dy)).toFixed(2)):null}));
  await mkdir(EVIDENCE,{recursive:true});await writeFile(path.join(EVIDENCE,'reference-comparison.json'),JSON.stringify({pages:[ref.pages,gen.pages],pageOffsetPt:offset,rows},null,2));
  expect(ref.pages).toBe(1);expect(gen.pages).toBe(1);expect(Math.hypot(offset.dx,offset.dy)).toBeLessThan(6);
  const compared=rows.filter(r=>r.residualPt!==null);expect(compared.length).toBe(rows.length);
  for(const r of compared)expect(r.residualPt!,`${r.anchor} layout differs from the real reference by ${r.residualPt}pt`).toBeLessThanOrEqual(1);
 },300000);
});
