import {describe,it,expect} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import fixture from '../fixtures/halos-full-synthetic.json';
import {readArchive,writeArchive,sha256} from '../../packages/workbook/archive';
import {MASTER_SHA256,inspectTaskMaster,generateTaskWorkbook} from '../../packages/workbook/master';
import {generateHalosWorkbook,verifyHalosWorkbook} from '../../packages/halos-export/workbook';

const ref=(id:string)=>({id,revision:1,sha256:'a'.repeat(64)});
const input=()=>({batch:ref('batch'),placement:ref('placement'),pool:ref('pool'),mapping:ref('explicit-mapping'),dnb:fixture.dnb,excludedBlank:fixture.excludedBlank,members:structuredClone(fixture.members)});
describe('Native operational HALOS XLSX',()=>{
  it('writes readback-verified 47 native rows, exact owner headers, typed numbers and truly empty E cells',()=>{
    const s=input(),out=generateHalosWorkbook(s),parts=readArchive(out.bytes),sheet=parts.get('xl/worksheets/sheet1.xml')!.toString();
    expect(out.bytes.subarray(0,2).toString()).toBe('PK');
    expect(sheet.match(/<row\b/g)).toHaveLength(48);
    expect(sheet).toContain('<dimension ref="A1:E48"/>');
    expect(sheet).toContain('<c r="D2"><v>1</v></c>');
    expect(sheet).not.toMatch(/<c r="D\d+"><v>13<\/v>/);
    expect(sheet.match(/<c r="E\d+"\/>/g)).toHaveLength(47);
    expect(sheet).not.toContain('r="A49"');
    expect(sheet).toContain('00SYN-48-1');
    expect(verifyHalosWorkbook(s,out.bytes)).toEqual(out.manifest);
    expect(out.manifest.liveHalosImportVerified).toBe(false);
  });
  it('rejects swapped barcode, missing member, wrong DNB date and stale mapping revision',()=>{
    const s=input();s.members[0].barcodeIndex=13;expect(()=>generateHalosWorkbook(s)).toThrow('HALOS_BARCODE_ORDER_MISMATCH');
    const partial=input();partial.members.pop();expect(()=>generateHalosWorkbook(partial)).toThrow();
    expect(()=>generateHalosWorkbook({...input(),dnb:{...fixture.dnb,id:'DNB20261013'}})).toThrow('HALOS_DNB_DATE_MISMATCH');
    const original=input(),out=generateHalosWorkbook(original);original.mapping.revision++;
    expect(verifyHalosWorkbook(original,out.bytes).sourceSha256).not.toBe(out.manifest.sourceSha256);
    // The caller compares the immutable manifest source hash as well as native readback.
  });
  it('detects altered bytes/types/extra parts and writes formula-looking identifiers as literal strings',()=>{
    const source=input();source.members[0].exportSampleId='=HYPERLINK("x")';
    const out=generateHalosWorkbook(source),parts=readArchive(out.bytes);
    expect(parts.get('xl/worksheets/sheet1.xml')!.toString()).toContain('=HYPERLINK(&quot;x&quot;)');
    parts.set('xl/worksheets/sheet1.xml',Buffer.from(parts.get('xl/worksheets/sheet1.xml')!.toString().replace('<c r="E2"/>','<c r="E2"><v>0</v></c>')));
    expect(()=>verifyHalosWorkbook(source,writeArchive(parts))).toThrow('HALOS_WORKBOOK_READBACK_MISMATCH');
  });
});
describe('Locked task master identity',()=>{
  it('refuses a different file even if it resembles a spreadsheet',()=>expect(()=>generateTaskWorkbook(Buffer.from('not approved'),{})).toThrow('TASK_MASTER_SHA256_MISMATCH'));
});
const masterPath=process.env.NIPT_TASK_MASTER_PATH??'C:/Users/User/Downloads/NIPT_CBH_Final_Combined_Master_2026-10-15.xlsx';
describe.skipIf(!existsSync(masterPath))('Exact owner-master native derivative integration',()=>{
  const master=()=>readFileSync(masterPath);
  it('identifies all six sheets and all 149 formulas, with actual bound cell evidence',()=>{
    const m=master(),matrix=inspectTaskMaster(m);
    expect(sha256(m)).toBe(MASTER_SHA256);expect(matrix.formulaCount).toBe(149);
    expect(new Set(matrix.cells.map(c=>c.sheet)).size).toBe(6);
    expect(matrix.bindings.length).toBeGreaterThan(300);
    for(const def of matrix.bindings) {
      const sheetIndex=['Ext. & Prep. Task List 1','Ext. & Prep. Task List 2','Ext. & Prep. Task List 3','QC measurements','Pooling Table','Seq Task-G50'].indexOf(def.sheet)+1;
      const xml=readArchive(m).get(`xl/worksheets/sheet${sheetIndex}.xml`)!.toString();
      const coord=(ref:string)=>{const [,col,row]=/^([A-Z]+)(\d+)$/.exec(ref)!;return {col:[...col].reduce((a,c)=>a*26+c.charCodeAt(0)-64,0),row:Number(row)};};
      for(const match of xml.matchAll(/<mergeCell ref="([A-Z]+\d+):([A-Z]+\d+)"/g)) {
        const p=coord(def.cell),a=coord(match[1]),b=coord(match[2]);
        if(p.col>=a.col&&p.col<=b.col&&p.row>=a.row&&p.row<=b.row)expect(def.cell).toBe(match[1]);
      }
    }
  });
  it('preserves static XML, all formula strings and every layout/media/style part; clears caches for recalculation',()=>{
    const source=master(),before=Buffer.from(source),parts=readArchive(source);
    const out=generateTaskWorkbook(source,{'task.1.run':'Run001/2026','slot.1.printedSampleId':'26B261012001R','slot.1.libraryQc':2.7,'check.1.A19':true,'pool.standard1':12,'seq.negativePressureKpa':-1.5});
    const generated=readArchive(out.bytes);
    expect(source.equals(before)).toBe(true);
    for(const [name,part] of parts) {
      if(!out.changedParts.includes(name))expect(generated.get(name)!.equals(part),name).toBe(true);
      if(name.startsWith('xl/worksheets/')) {
        const formulas=(b:Buffer)=>[...b.toString().matchAll(/<f\b[^>]*>[\s\S]*?<\/f>/g)].map(m=>m[0]);
        expect(formulas(generated.get(name)!)).toEqual(formulas(part));
      }
    }
    expect(generated.get('xl/worksheets/sheet1.xml')!.toString()).toContain('26B261012001R');
    expect(generated.get('xl/worksheets/sheet1.xml')!.toString()).toContain('<rFont val="TH Sarabun New"/>');
    expect(generated.get('xl/worksheets/sheet1.xml')!.toString()).toContain('☑');
    expect(generated.get('xl/worksheets/sheet4.xml')!.toString()).not.toMatch(/<f[^>]*>[\s\S]*?<\/f><v>/);
    expect(generated.get('xl/workbook.xml')!.toString()).toContain('forceFullCalc="1"');
  });
  it('rejects unknown/formula field injection and resets absent inputs from immutable master',()=>{
    const m=master();expect(()=>generateTaskWorkbook(m,{'QC measurements!B7':'overwrite'})).toThrow('TASK_FIELD_UNKNOWN');
    expect(()=>generateTaskWorkbook(m,{'slot.1.libraryQc':NaN})).toThrow('TASK_FIELD_TYPE');
    const out=generateTaskWorkbook(m,{'task.1.run':'new batch'}),sheet=readArchive(out.bytes).get('xl/worksheets/sheet1.xml')!.toString();
    expect(sheet).not.toContain('26B261012001R');
    expect(()=>generateTaskWorkbook(out.bytes,{})).toThrow('TASK_MASTER_SHA256_MISMATCH');
  });
});
