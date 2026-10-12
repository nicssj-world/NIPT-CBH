import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {describe,it,expect} from 'vitest';
import {extract} from '../../packages/results/extract';
import {parseReport} from '../../packages/results/parser';

// AT-RES-01 / Legacy parity: the 100 synthetic BGI samples of NIPTY_handover.zip (samples/bgi_pdf + cases.csv) are parsed by the
// new parser and compared with the legacy expectations. The samples are never copied into the repository: point
// NIPT_LEGACY_RESULT_SAMPLES_DIR at a read-only extraction (all 100 PDFs/ZIP-as-PDF plus cases.csv in one folder).
const dir=process.env.NIPT_LEGACY_RESULT_SAMPLES_DIR;
const csv=(text:string)=>{const rows:string[][]=[];for(const line of text.replace(/^﻿/,'').split(/\r?\n/).filter(Boolean)){const out:string[]=[];let cur='',q=false;for(const ch of line){if(ch==='"'){q=!q;continue;}if(ch===','&&!q){out.push(cur);cur='';continue;}cur+=ch;}out.push(cur);rows.push(out);}return rows;};
describe.skipIf(!dir)('P5 legacy sample parity (NIPTY_handover samples/bgi_pdf)',()=>{
 it('classifies and reads all 100 legacy synthetic result files exactly as cases.csv records them',async()=>{
  const [header,...rows]=csv(await readFile(path.join(dir!,'cases.csv'),'utf8'));const col=(n:string)=>header.indexOf(n);
  expect(rows).toHaveLength(100);const mismatches:string[]=[];
  for(const r of rows){
   const bytes=await readFile(path.join(dir!,r[col('bgi_file')]));const x=await extract(bytes);
   if(x.container==='ZIP_BATCH'){mismatches.push(`${r[0]}:BATCH`);continue;}
   expect(x.container).toBe(r[col('bgi_format')]==='PDF'?'PDF':'ZIP_AS_PDF');
   const p=parseReport(x.text,r[col('bgi_file')]),expected=r[col('result_type')];
   if(p.identifiers.hn.value!==r[col('HN')])mismatches.push(`${r[0]}:HN`);
   if(p.identifiers.labNumber.value!==r[col('bgi_lab_LN')])mismatches.push(`${r[0]}:LN`);
   if(expected==='final'){
    if(p.templateKind!=='SINGLETON')mismatches.push(`${r[0]}:KIND:${p.templateKind}`);
    if([p.results.t21.value,p.results.t18.value,p.results.t13.value].join(' / ')!==r[col('T21/T18/T13')])mismatches.push(`${r[0]}:TRISOMY`);
    if([p.results.xo.value,p.results.xxx.value,p.results.xxy.value,p.results.xyy.value].join(',')!==r[col('XO,XXX,XXY,XYY')])mismatches.push(`${r[0]}:SCA`);
    if(p.results.t21.method!=='ANCHORED'||p.results.xo.method!=='ANCHORED')mismatches.push(`${r[0]}:NOT_ANCHORED`);
   }else if(expected==='redraw_notice'){if(p.templateKind!=='REDRAW_NOTICE')mismatches.push(`${r[0]}:NOTICE:${p.templateKind}`);}
   else mismatches.push(`${r[0]}:UNEXPECTED_TYPE:${expected}`);
  }
  expect(mismatches).toEqual([]);
 },120000);
});
