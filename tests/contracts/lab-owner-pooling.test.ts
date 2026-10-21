import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {calculateOwnerPooling,ownerDilution,poolConcentrationOutOfRange,exportOwnerPoolingCsv,type PhysicalQc} from '../../packages/pooling/owner-master';
import {readArchive,writeArchive} from '../../packages/workbook/archive';
const master=readFileSync('C:/Users/User/Downloads/NIPT_CBH_Final_Combined_Master_2026-10-15.xlsx');
const csv=readFileSync('C:/Users/User/Downloads/Pooling Sheet Template_R001.csv');
function rows():PhysicalQc[]{return Array.from({length:48},(_,i)=>({slot:i+1,sampleId:'SYNTHETIC-SLOT-'+(i+1),kind:i===0?'PC':i===24?'NC':i===39?'BLANK':'PATIENT',concentration:i===39?null:'20'}));}
describe('LAB-12/13 actual Owner Master and CSV contract',()=>{
 it('uses 47 actual measurements including PC/NC, excluding only the unmeasured BLANK',()=>{
  const r=calculateOwnerPooling(master,rows());expect(r.measuredCount).toBe(47);expect(Number(r.rows[0].volume)).toBeCloseTo(160/47*16/20,12);expect(r.rows[24].volume).toBe(r.rows[0].volume);expect(r.rows[39].volume).toBeNull();expect(r.desired).toBe('768');
 });
 it('preserves all 48 B/C/D/E rows and CRLF/header while changing only A/F, including urgent 40',()=>{
  const input=rows();input[39]={...input[39],kind:'PATIENT',concentration:'40'};input[0].concentration='80';
  const r=calculateOwnerPooling(master,input),out=exportOwnerPoolingCsv(csv,r).toString().split('\r\n'),before=csv.toString().split('\r\n');
  expect(out).toHaveLength(50);expect(out[0]).toBe(before[0]);expect(out[49]).toBe('');
  for(let slot=1;slot<=48;slot++){expect(out[slot].split(',').slice(1,5)).toEqual(before[slot].split(',').slice(1,5));expect(out[slot].split(',')[0]).toBe(input[slot-1].sampleId);}
  expect(out[1].split(',')[5]).toBe('0');expect(out[40].split(',')[5]).toBe('0');
 });
 it('does not round a value below 2 into eligibility; exactly 2 is retained',()=>{
  const input=rows();input[39].concentration='20';input[0].concentration='26.666666666667';
  let r=calculateOwnerPooling(master,input);expect(r.rows[0].belowTwo).toBe(true);expect(r.rows[0].csvVolume).toBe('0');
  // 160/48*16/2 = 80/3, so use a denominator with an exact decimal boundary.
  for(let i=1;i<=8;i++){input[i].kind='EMPTY';input[i].sampleId='';input[i].concentration=null;}
  const count=input.filter(r=>r.concentration!==null).length;input[0].concentration=String(1280/count);
  r=calculateOwnerPooling(master,input);expect(r.rows[0].belowTwo).toBe(false);expect(Number(r.rows[0].volume)).toBeCloseTo(2,12);
 });
 it('enforces 3.00 and 3.60 inclusive and exact Master dilution constants',()=>{
  expect(['2.99','3','3.6','3.61'].map(poolConcentrationOutOfRange)).toEqual([true,false,false,true]);
  expect(ownerDilution(master,'6.66')).toMatchObject({v1:'50',eb:'50',target:'3.33',total:'100'});
  expect(()=>ownerDilution(master,'0')).toThrow('DILUTION_C1_MUST_BE_POSITIVE');expect(()=>ownerDilution(master,'2')).toThrow('DILUTION_NEGATIVE_EB');
 });
 it('never substitutes zero for missing/invalid concentrations or accepts a changed formula/template',()=>{
  const input=rows();input[1].concentration=null;expect(()=>calculateOwnerPooling(master,input)).toThrow('QC_MEASUREMENT_REQUIRED:2');input[1].concentration='0';expect(()=>calculateOwnerPooling(master,input)).toThrow('QC_CONCENTRATION_MUST_BE_POSITIVE:2');
  const parts=readArchive(master);parts.set('xl/worksheets/sheet5.xml',Buffer.from(parts.get('xl/worksheets/sheet5.xml')!.toString().replace('160/COUNTA','159/COUNTA')));expect(()=>calculateOwnerPooling(writeArchive(parts),rows())).toThrow('POOL_MASTER_FORMULA_MISMATCH');
  expect(()=>exportOwnerPoolingCsv(Buffer.from('changed'),calculateOwnerPooling(master,rows()))).toThrow('POOL_CSV_TEMPLATE_SHA256_MISMATCH');
 });
});
