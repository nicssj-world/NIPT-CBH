import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {readHalosWorkbook,readNiftyRequestRows} from '../../packages/readygen/halos-adapter';
import {interpretRow,READYGEN_REFERENCE_SHA256,productCodeOf,TEMPLATES} from '../../packages/readygen/interpretation';
import {fillReport,docxText} from '../../packages/readygen/docx';
import {readArchive} from '../../packages/workbook/archive';
import {pdfText} from '../../packages/results/extract';
import {parseReport} from '../../packages/results/parser';
import {syntheticSignaturePng} from '../helpers/signature-png';

// Owner-provided originals, read only from the protected, git-ignored local copy (.local/task3-sources). These files contain PHI:
// assertions use counts, classes and hashes only and nothing is printed. A missing file fails the test (never a silent skip).
const SRC=path.resolve('.local/task3-sources'),read=(n:string)=>readFileSync(path.join(SRC,n));
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
describe('Task 3 Owner source files (protected local copies)',()=>{
 it('every source is the exact Owner original by SHA-256',()=>{
  expect(sha(read('halos-S250204991.xlsx'))).toBe('bccade7d24779eb8f82a1723766324313314fa9e389a460b20bbdd6ce51dabed');
  expect(sha(read('nifty-run2.xlsx'))).toBe('46569117780dd03224ee4262bd5db14a83697b477757804552592cc1223d556d');
  expect(sha(read('singleton.docx'))).toBe(TEMPLATES.SINGLETON.sha256);expect(sha(read('twin.docx'))).toBe(TEMPLATES.TWIN.sha256);
  expect(sha(read('reference-singleton.pdf'))).toBe('cfc4b061a5a39879313c3fde32d382c92c970314ef889fef478d6be321c785a3');
  expect(sha(read('readygen-enrich.txt'))).toBe(READYGEN_REFERENCE_SHA256);
 });
 it('real HALOS workbook: 46 result / 2 repeat / 46 sampleinfo, one chip, controls, the ML21 Rerun repeat and the result+repeat duplicate',()=>{
  const w=readHalosWorkbook(read('halos-S250204991.xlsx'));
  expect(w.counts).toEqual({result:46,repeat:2,sampleinfo:46});expect(w.chipIds).toHaveLength(1);expect(w.issues).toEqual([]);
  const result=w.rows.filter(r=>r.sheet==='result'),repeat=w.rows.filter(r=>r.sheet==='repeat');
  const controls=result.filter(r=>/^\d{2}N\d/.test(r.sampleKey));expect(controls).toHaveLength(2);
  expect(controls.some(c=>c.values.testChr21==='TH21')).toBe(true);
  const ml=repeat.find(r=>r.values.testChr21==='ML21')!;expect(ml.values.sampleQc).toBe('Pass');expect(ml.values.operationAdvice).toBe('Rerun');expect(ml.values.chipId).not.toBe(w.chipIds[0]);
  const dup=repeat.find(r=>r!==ml)!;expect(result.some(r=>r.sampleKey===dup.sampleKey)).toBe(true);
  // Interpretation over every real row: the ML21 Rerun and the controls (blank sex call) are HOLD; nothing defaults to Low Risk.
  const ml21=interpretRow(ml,'SINGLETON');expect(ml21.status).toBe('HOLD');expect(ml21.holds.map(h=>h.code)).toEqual(expect.arrayContaining(['QC_RERUN_ADVISED','T21_TOKEN_UNRECOGNIZED']));
  for(const c of controls)expect(interpretRow(c,'SINGLETON').status).toBe('HOLD');
  const patients=result.filter(r=>!/^\d{2}N\d/.test(r.sampleKey)).map(r=>interpretRow(r,'SINGLETON'));
  expect(patients).toHaveLength(44);expect(patients.filter(p=>p.status==='FINAL_ELIGIBLE').length+patients.filter(p=>p.status==='HOLD').length).toBe(44);
  expect(patients.filter(p=>p.values.t21==='High Risk')).toHaveLength(1);
  const info=w.rows.filter(r=>r.sheet==='sampleinfo');expect(new Set(info.map(r=>productCodeOf(r.values.productName)))).toEqual(new Set(['HNZ0011']));
 });
 it('real NIFTY export: 45 sample rows including PC/NC, product HNZ0011, and one HALOS sample absent from it',()=>{
  const rows=readNiftyRequestRows(read('nifty-run2.xlsx'));expect(rows).toHaveLength(45);
  expect(rows.filter(r=>r.sampleRaw!==r.sampleKey)).toHaveLength(1);// a pasted leading TAB is preserved raw
  expect(new Set(rows.map(r=>r.cells.B))).toEqual(new Set(['HNZ0011']));
  const halos=readHalosWorkbook(read('halos-S250204991.xlsx')).rows.filter(r=>r.sheet==='sampleinfo').map(r=>r.sampleKey);
  const nifty=new Set(rows.map(r=>r.sampleKey));expect(halos.filter(h=>!nifty.has(h))).toHaveLength(1);
  // Product HNZ0011 against masters titled HNZ0051: compatibility is not inferred anywhere in code.
  expect(TEMPLATES.SINGLETON.product).toBe('HNZ0051');
 });
 it('both Owner masters fill with no leftover placeholder and none of the master signer names, licences, images or literal QC',()=>{
  const values={patientName:'นางสาวจำลอง ทดสอบ',ga:'15W 3D',sampleID:'99B990101001-1',hn:'99000001',collectDate_cbh:'14-Oct-2026',patientIDCard:'-',dob_cbh:'01-Jan-1995',receivedDate_cbh:'14-Oct-2026',referringPhysician:'-',hospitalName:'Chonburi hospital',remarks:'',sampleType:'Peripheral Blood',
   qc:'PASS',trisomy21_ra:'Low Risk',trisomy18_ra:'Low Risk',trisomy13_ra:'Low Risk',risk21:'1/2',risk18:'1/3',risk13:'1/4',gender:'Female',gender_cbh:'Not Detected',XO_NEW:'Not Detected',XXX_NEW:'Not Detected',XXY_NEW:'Not Detected',XYY_NEW:'Not Detected',fetalFaction_2:'14.70'};
  for(const [kind,file] of [['SINGLETON','singleton.docx'],['TWIN','twin.docx']] as const){
   const master=read(file),f=fillReport(master,kind,values,{reported:{name:'Synthetic Reporter',license:'99001',date:'24-Oct-2026',signature:{bytes:syntheticSignaturePng(1),media:'image/png'}},approved:{name:'Synthetic Approver',license:'99002',date:'25-Oct-2026',signature:{bytes:syntheticSignaturePng(2),media:'image/png'}}});
   const text=docxText(f.bytes),parts=readArchive(f.bytes),masterParts=readArchive(master);
   expect(text).not.toMatch(/\$\{|Sirithorn|Siriwat|13099|12396/);expect(text).toContain('Reported Date: 24-Oct-2026');expect(text).toContain('Approved Date: 25-Oct-2026');
   // Master signature pictures (and their HD-photo layer) are not carried in the output package.
   const masterMedia=[...masterParts.keys()].filter(k=>/^word\/media\/(image[12]|hdphoto)/.test(k));
   for(const m of masterMedia)expect(parts.has(m),m).toBe(false);
   expect([...parts.keys()].filter(k=>k.startsWith('word/media/t3-signature-'))).toHaveLength(2);
   // Header/footer, styles, fonts and every other master part are byte-identical.
   for(const [k,b] of masterParts)if(!/^word\/(document\.xml|_rels\/document\.xml\.rels|media\/(image[12]|hdphoto))/.test(k))expect(parts.get(k)?.equals(b),k).toBe(true);
   expect(f.bindings.filter(b=>b.token==='signer.license').length).toBeGreaterThanOrEqual(2);
  }
 });
 it('the real ReadyGen reference PDF parses with the GA layout "15W 3D" (parser 1.0.3) and its LN keeps the analytical suffix',async()=>{
  const p=parseReport((await pdfText(read('reference-singleton.pdf'))).text,'reference.pdf');
  expect(p.templateKind).toBe('SINGLETON');expect(p.identifiers.gestationalAgeDays.method).toBe('ANCHORED');expect(p.identifiers.labNumber.value).toMatch(/-1$/);
  expect(p.results.qc.value).toBe('PASS');expect(p.results.fetalFraction.method).toBe('ANCHORED');
 });
});
