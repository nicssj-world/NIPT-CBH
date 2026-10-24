import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {exportOwnerNifty,patientVendorValues,petDisplayName,type VendorRow,type VendorPatient} from '../../packages/sequencing/owner-export';
import {readArchive} from '../../packages/workbook/archive';
const template=readFileSync('C:/Users/User/Downloads/NIFTY_Test_Request_FormHNZ_filled.xlsx');
const patient=(slot:number):VendorPatient=>({slot,kind:'PATIENT',sampleId:`26B261020${String(slot).padStart(3,'0')}-1`,ln:'9900000001',hn:'9900001',name:'ทดสอบ^^นาง สมมติ',identity:'',dob:'1990-10-21',collectionAt:'2026-10-20T08:09:10+07:00',receivedAt:'2026-10-20T10:11:12+07:00',edd:'2027-03-24',pregnancy:'Singleton',doctor:'SYNTHETIC doctor'});
const rows=(urgent=false):VendorRow[]=>Array.from({length:48},(_,i):VendorRow|null=>i===0?{slot:1,kind:'PC',sampleId:'26N120261020-1'}:i===24?{slot:25,kind:'NC',sampleId:'26N220261020-1'}:i===39&&!urgent?null:patient(i+1)).filter((r):r is VendorRow=>r!==null);
describe('LAB-13 Owner NIFTY immutable schema and row contract',()=>{
 it.each([false,true])('exports patients first then PC/NC with internal reversible mapping, urgent=%s',urgent=>{
  const result=exportOwnerNifty(template,rows(urgent)),parts=readArchive(result.bytes),original=readArchive(template),xml=parts.get('xl/worksheets/sheet1.xml')!.toString();
  expect(result.patientCount).toBe(urgent?46:45);expect(result.mapping.slice(-2).map(r=>r.physicalSlot)).toEqual([1,25]);
  expect(result.mapping.filter(r=>r.physicalSlot===40)).toHaveLength(urgent?1:0);
  expect(xml).toContain('Positive control');expect(xml).toContain('Negative Control');
  for(const row of result.mapping)expect(xml).toMatch(new RegExp(`<c[^>]*r="Q${row.exportRow}"[^>]*>[\\s\\S]*?<t[^>]*>ANC</t>`));
  const cell=(ref:string)=>new RegExp(`<c[^>]*r="${ref}"[^>]*>([\\s\\S]*?)</c>`).exec(xml)?.[1];
  expect(cell('Z2')).toContain('<v>1</v>');expect(cell('Z'+result.mapping.at(-2)!.exportRow)).not.toContain('<v>');
  expect(cell('A2')).not.toContain('-1');expect(cell('L2')).not.toContain('hash');
  for(const [name,bytes] of original)if(name!=='xl/worksheets/sheet1.xml')expect(parts.get(name)!.equals(bytes),name).toBe(true);
 });
 it('retains actual PET clock, EDC GA, integer age at collection and missing/passport identity',()=>{
  const p=patient(2);expect(patientVendorValues(p,1)).toMatchObject({E:'10/20/2026 08:09',F:'10/20/2026 10:11',G:'17,6',N:35,L:'',M:'10/21/1990',AA:'03/24/2027',H:'Singleton'});
  expect(patientVendorValues({...p,pregnancy:'Twins',identity:'PASSPORT-ABC',sampleId:'26B261020002DR'},1)).toMatchObject({H:'Twins',L:'PASSPORT-ABC',A:'26B261020002DR'});
  expect(petDisplayName(p.name)).toBe('นาง สมมติ ทดสอบ');
 });
 it('fails closed for missing provenance, impossible dates, duplicate positions and altered template',()=>{
  expect(()=>patientVendorValues({...patient(2),receivedAt:''},1)).toThrow('VENDOR_PET_TIMESTAMP_REQUIRED');
  expect(()=>patientVendorValues({...patient(2),receivedAt:'2026-10-19T00:00:00+07:00'},1)).toThrow('VENDOR_SOURCE_DATES_INCONSISTENT');
  expect(()=>exportOwnerNifty(template,[...rows(),patient(2)])).toThrow('VENDOR_PHYSICAL_MAPPING_INVALID');
  expect(()=>exportOwnerNifty(Buffer.from('changed'),rows())).toThrow('NIFTY_TEMPLATE_SHA256_MISMATCH');
 });
});

it.each(['26B261023001-1','26B261023001-2','26B261023001R-1','26B261023001R-2','26B261023001DR-1','26B261023001DR-2'])('NIFTY drops only terminal analytical 1/2: %s',sampleId=>{
 const p={...patient(2),sampleId,attemptId:'internal-attempt',roundId:'internal-round',caseId:'internal-case',overallOrdinal:5};
 const out=exportOwnerNifty(template,[p,{slot:1,kind:'PC',sampleId:'PC-1'},{slot:25,kind:'NC',sampleId:'NC-1'}]);
 const expected=sampleId.replace(/-[12]$/,'');expect(patientVendorValues(p,1).A).toBe(expected);expect(out.mapping[0]).toMatchObject({sampleId,vendorSampleId:expected,attemptId:p.attemptId,roundId:p.roundId,caseId:p.caseId,overallOrdinal:5});
 const xml=readArchive(out.bytes).get('xl/worksheets/sheet1.xml')!.toString();expect(xml).toContain(expected);expect(xml).not.toContain(p.attemptId);
});
it('NIFTY rejects ambiguity introduced by its approved suffix removal',()=>{
 expect(()=>exportOwnerNifty(template,[{...patient(2),sampleId:'26B261023001R-1'},{...patient(3),sampleId:'26B261023001R-2'},{slot:1,kind:'PC',sampleId:'PC-1'},{slot:25,kind:'NC',sampleId:'NC-1'}])).toThrow('VENDOR_DUPLICATE_SAMPLE_ID');
});
