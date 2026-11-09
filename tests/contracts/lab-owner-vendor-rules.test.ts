import {existsSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {describe,expect,it} from 'vitest';
import {exportOwnerNifty,type VendorPatient,type VendorRow} from '../../packages/sequencing/owner-export';
import {exportOwnerTaskImport} from '../../packages/sequencing/owner-task-import';
import {vendorExportable} from '../../packages/lab/repeat-slots';
import {readArchive} from '../../packages/workbook/archive';

// The Owner's approved vendor templates (pinned by SHA-256 inside the exporters). Looked up like the application does, then in the dev copy.
const find=(name:string)=>[process.env.NIPT_TASK_MASTER_PATH&&path.join(path.dirname(process.env.NIPT_TASK_MASTER_PATH),name),path.resolve('.local/approved',name),path.resolve('../NIPT-CBH/.local/approved',name)].find(p=>!!p&&existsSync(p));
const niftyPath=find('nifty.xlsx'),halosPath=find('halos-task.xlsx');

const cell=(xml:string,ref:string)=>{const m=new RegExp(`<c[^>]*r="${ref}"[^>]*?(?:/>|>([\\s\\S]*?)</c>)`).exec(xml);return m?(m[1]??'').replace(/<[^>]+>/g,''):null;};
const sheetXml=(bytes:Buffer)=>readArchive(bytes).get('xl/worksheets/sheet1.xml')!.toString();

describe.skipIf(!halosPath)('HALOS Task Import: Sample ID without -1/-2, every occupied position kept (Owner 2026-11-09)',()=>{
 it('drops the analytical suffix; Twins D and Re-sampling R stay in the code',()=>{
  const out=exportOwnerTaskImport(readFileSync(halosPath!),[
   {slot:1,sampleId:'26N120261022-1'},{slot:2,sampleId:'26B261022001-1'},{slot:3,sampleId:'26B261022002D-1'},{slot:4,sampleId:'26B261022003R-1'},{slot:5,sampleId:'26B261022004DR-2'},{slot:25,sampleId:'26N220261022-1'}],new Date('2026-11-09T05:00:00Z'));
  const xml=sheetXml(out.bytes);
  expect([2,3,4,5,6,7].map(n=>cell(xml,'A'+n))).toEqual(['26N120261022','26B261022001','26B261022002D','26B261022003R','26B261022004DR','26N220261022']);
  expect(out.mapping.map(m=>m.vendorSampleId)).toEqual(['26N120261022','26B261022001','26B261022002D','26B261022003R','26B261022004DR','26N220261022']);
 });
 it('refuses two positions that would share one Sample ID once the suffix is dropped',()=>{
  expect(()=>exportOwnerTaskImport(readFileSync(halosPath!),[{slot:2,sampleId:'26B261022001-1'},{slot:3,sampleId:'26B261022001-2'}],new Date())).toThrow('TASK_IMPORT_DUPLICATE_SAMPLE_ID');
 });
});

describe('Which positions go to the vendor files',()=>{
 const repeating=new Set(['failed']);
 it('keeps every occupied position, a position below 2 µL included; leaves out Blank, empty and Re-xxx slots',()=>{
  expect(vendorExportable({attemptId:'a',printedSampleId:'26B261022001-1'},repeating)).toBe(true);        // patient (pooled or below 2 µL: the volume is not a condition)
  expect(vendorExportable({control:'positive',printedControlId:'26N120261022-1'},repeating)).toBe(true);
  expect(vendorExportable({control:'negative',printedControlId:'26N220261022-1'},repeating)).toBe(true);
  expect(vendorExportable({control:'blank',printedControlId:'26N320261022-1'},repeating)).toBe(false);
  expect(vendorExportable({attemptId:null,printedSampleId:null},repeating)).toBe(false);
  expect(vendorExportable({attemptId:'failed',printedSampleId:'26B261022002-1'},repeating)).toBe(false);
 });
});

describe.skipIf(!niftyPath)('NIFTY request: every * column is filled on the Positive and Negative control rows (Owner 2026-11-09)',()=>{
 const patient=(slot:number,collectionAt:string,receivedAt:string):VendorPatient=>({slot,kind:'PATIENT',sampleId:`26B261020${String(slot).padStart(3,'0')}-1`,ln:'9900000001',hn:'9900001',name:'ทดสอบ^^นาง สมมติ',identity:'',dob:'1990-10-21',collectionAt,receivedAt,edd:'2027-03-24',pregnancy:'Singleton',doctor:'SYNTHETIC doctor'});
 const rows:VendorRow[]=[{slot:1,kind:'PC',sampleId:'26N120261020-1'},patient(2,'2026-10-20T08:09:10+07:00','2026-10-20T10:11:12+07:00'),patient(3,'2026-10-19T07:30:00+07:00','2026-10-20T13:45:00+07:00'),{slot:25,kind:'NC',sampleId:'26N220261020-1'}];
 it('A to I are filled for patients and both controls',()=>{
  const out=exportOwnerNifty(readFileSync(niftyPath!),rows),xml=sheetXml(out.bytes);
  for(const row of out.mapping)for(const col of ['A','B','C','D','E','F','G','H','I'])expect(cell(xml,col+row.exportRow),`${col}${row.exportRow}`).toBeTruthy();
  const pc=out.mapping.find(m=>m.kind==='PC')!.exportRow,nc=out.mapping.find(m=>m.kind==='NC')!.exportRow;
  for(const n of [pc,nc]){expect(cell(xml,'E'+n)).toBe('10/19/2026 07:30');expect(cell(xml,'F'+n)).toBe('10/20/2026 13:45');expect(cell(xml,'G'+n)).toBe('13,5');expect(cell(xml,'H'+n)).toBe('Singleton');}
  expect(cell(xml,'K'+pc)).toBe('Positive control');expect(cell(xml,'K'+nc)).toBe('Negative Control');
 });
 it('with no patient in the file the controls take the date in their own code',()=>{
  const out=exportOwnerNifty(readFileSync(niftyPath!),[rows[0],rows[3]]),xml=sheetXml(out.bytes);
  for(const row of out.mapping){expect(cell(xml,'E'+row.exportRow)).toBe('10/20/2026 00:00');expect(cell(xml,'F'+row.exportRow)).toBe('10/20/2026 00:00');}
 });
});
