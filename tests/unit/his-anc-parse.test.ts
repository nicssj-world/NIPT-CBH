import {describe,it,expect,vi} from 'vitest';
import {parseHisAncWorkbook,splitGa,isDoctorName,HisAncError} from '../../packages/his-anc/parse';
import {hisAncWorkbook,hisAncRow,HIS_ANC_HEADER} from '../helpers/his-anc-workbook';

const code=(f:()=>unknown)=>{try{f();return null;}catch(e){return e instanceof HisAncError?e.code:'OTHER';}};
const one=(over:Parameters<typeof hisAncRow>[0])=>parseHisAncWorkbook(hisAncWorkbook([hisAncRow(over)]))[0];

describe('HIS ANC export: GA "W+D"',()=>{
 it('splits weeks and days; days over 6 carry into weeks',()=>{
  expect(splitGa('28+0')).toEqual({weeks:28,days:0});
  expect(splitGa('20+7')).toEqual({weeks:21,days:0});
  expect(splitGa('13+13')).toEqual({weeks:14,days:6});
  expect(splitGa(' 9+3 ')).toEqual({weeks:9,days:3});
 });
 it('anything else is not a GA',()=>{for(const v of ['abc','','28','+3','28+','28-1'])expect(splitGa(v)).toBeNull();});
});

describe('HIS ANC export: who is a doctor (Owner 2026-11-18: only พญ./นพ.)',()=>{
 it('พญ. and นพ. are doctors; other titles are not',()=>{
  expect(isDoctorName('พญ.ทัศพร เชียงทอง')).toBe(true);
  expect(isDoctorName('นพ. ก ข')).toBe(true);
  expect(isDoctorName('น.ส.สุภาวรรณ ใจดี')).toBe(false);
  expect(isDoctorName('ภญ.ก')).toBe(false);
  expect(isDoctorName('')).toBe(false);
 });
});

describe('HIS ANC export workbook',()=>{
 it('reads a complete row',()=>{
  expect(one({})).toEqual({rowNo:2,hn:'9901001',cid:'1209000008138',visitDate:'2026-11-18',gravida:2,ga:{weeks:28,days:0},edc:'2027-02-10',provider:'พญ.SYNTHETIC ทดสอบ',weightKg:99.6,heightCm:160,incomplete:null});
 });
 it('a missing or renamed column refuses the file',()=>{
  expect(code(()=>parseHisAncWorkbook(hisAncWorkbook([hisAncRow()],HIS_ANC_HEADER.filter(h=>h!=='ga'))))).toBe('HEADER_MISMATCH');
  expect(code(()=>parseHisAncWorkbook(hisAncWorkbook([hisAncRow()],HIS_ANC_HEADER.map(h=>h==='edc'?'edd':h))))).toBe('HEADER_MISMATCH');
 });
 it('header case and spaces do not matter',()=>{expect(parseHisAncWorkbook(hisAncWorkbook([hisAncRow()],HIS_ANC_HEADER.map(h=>' '+h.toUpperCase()))).length).toBe(1);});
 it('a file with no data rows, or not an xlsx, is refused',()=>{
  expect(code(()=>parseHisAncWorkbook(hisAncWorkbook([])))).toBe('EMPTY_FILE');
  expect(code(()=>parseHisAncWorkbook(Buffer.from('hn\tcid\n')))).toBe('NOT_XLSX');
 });
 it('weight or height 0 is empty, the row stays complete',()=>{
  const r=one({weight:'0.0',height:'0'});expect(r.weightKg).toBeNull();expect(r.heightCm).toBeNull();expect(r.incomplete).toBeNull();
 });
 it('G = 0 makes the row incomplete',()=>{expect(one({gravida:'0'}).incomplete).toBe('G_ZERO');});
 it('EDC that disagrees with GA by more than 3 days makes the row incomplete',()=>{
  expect(one({ga:'1+0',edc:'18/11/2026'}).incomplete).toBe('EDC_GA_MISMATCH');
  expect(one({ga:'28+0',edc:'13/02/2027'}).incomplete).toBeNull();   // +3 days is fine
  expect(one({ga:'28+0',edc:'14/02/2027'}).incomplete).toBe('EDC_GA_MISMATCH');
 });
 it('missing EDC is allowed; missing or bad GA is not',()=>{
  expect(one({edc:''})).toMatchObject({edc:null,incomplete:null});
  expect(one({ga:''}).incomplete).toBe('BAD_GA');
 });
 it('a synthetic PET identity stands in for the CID only while operational data is off',()=>{
  expect(one({cid:'SYNTHETIC-ID-P3'}).incomplete).toBeNull();
  vi.stubEnv('NIPT_MODE','operational');vi.stubEnv('APP_ORIGIN','https://nipt.test');try{expect(one({cid:'SYNTHETIC-ID-P3'}).incomplete).toBe('BAD_IDENTIFIER');}finally{vi.unstubAllEnvs();}
 });
 it('numeric-looking cells (a re-saved file) never pass as an identifier or date',()=>{
  expect(one({cid:'1.20900000814E+12'}).incomplete).toBe('BAD_IDENTIFIER');
  expect(one({hn:''}).incomplete).toBe('BAD_IDENTIFIER');
  expect(one({date_serv:'46344'}).incomplete).toBe('BAD_DATE');
  expect(one({edc:'2027-02-10'}).incomplete).toBe('BAD_DATE');
  expect(one({date_serv:'31/02/2026'}).incomplete).toBe('BAD_DATE');
 });
});
