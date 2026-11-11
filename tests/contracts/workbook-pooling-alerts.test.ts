import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {generateTaskWorkbook,inspectTaskMaster,validateTaskValues} from '../../packages/workbook/master';
import {readArchive} from '../../packages/workbook/archive';
import {applyPoolingLayout} from '../../packages/workbook/pooling-layout';
import {calculateOwnerPooling,type PhysicalQc} from '../../packages/pooling/owner-master';
const master=readFileSync('.local/lab-owner-evidence/lab-combined-master.xlsx');
it('native Pooling alerts use actual calculated cells and preserve every original font and formula',()=>{
 const values:Record<string,unknown>={};for(let i=1;i<=48;i++)values[`slot.${i}.libraryQc`]=i===2?30:20;
 const original=readArchive(master);applyPoolingLayout(original);const base=original.get('xl/worksheets/sheet5.xml')!.toString();
 for(const concentration of [3,3.6,3.61]){
  const parts=readArchive(generateTaskWorkbook(master,{...values,'pool.concentration':concentration}).bytes),xml=parts.get('xl/worksheets/sheet5.xml')!.toString(),styles=parts.get('xl/styles.xml')!.toString();
  expect(xml).toContain('sqref="B8:C55"');expect(xml).toContain('AND(ISNUMBER($C8),$C8&lt;2)');
  expect(xml).toContain('AND(ISNUMBER(F14),OR(F14&lt;3,F14&gt;3.6))');expect(styles).toContain('<dxf><font><color rgb="FFFF0000"/></font></dxf>');
  // Owner 2026-11-11: a Volume below 2 µL is also filled light on Barcode (A), Sample ID (B) and Volume (C) by its own rule and dxf.
  const dxfs=[...(/<dxfs\b[^>]*>([\s\S]*?)<\/dxfs>/.exec(styles)![1]).matchAll(/<dxf\b[^>]*>[\s\S]*?<\/dxf>/g)].map(m=>m[0]),fillId=dxfs.findIndex(d=>d.includes('FFFFC7CE'));
  expect(fillId).toBeGreaterThan(0);expect(dxfs[fillId]).not.toContain('<font>');
  expect(xml).toMatch(new RegExp(`<conditionalFormatting sqref="A8:C55"><cfRule type="expression" dxfId="${fillId}" priority="\\d+"><formula>AND\\(ISNUMBER\\(\\$C8\\),\\$C8&lt;2\\)</formula>`));
  expect(xml).not.toMatch(new RegExp(`sqref="F14"><cfRule type="expression" dxfId="${fillId}"`)); // the concentration check keeps only its red font
  expect(/<fonts[^>]*>[\s\S]*?<\/fonts>/.exec(styles)![0]).toBe(/<fonts[^>]*>[\s\S]*?<\/fonts>/.exec(original.get('xl/styles.xml')!.toString())![0]);
  expect([...xml.matchAll(/<f\b[^>]*>[\s\S]*?<\/f>/g)].map(m=>m[0])).toEqual([...base.matchAll(/<f\b[^>]*>[\s\S]*?<\/f>/g)].map(m=>m[0]));
 }
});

const rows:PhysicalQc[]=Array.from({length:48},(_,i)=>({slot:i+1,sampleId:`SYNTHETIC-${i+1}`,kind:i===0?'PC':i===24?'NC':i===39?'BLANK':'PATIENT',concentration:'20'}));

it('uses the saved amount for sample volumes, desired volume and buffer',()=>{
 const result=calculateOwnerPooling(master,rows,'12');
 expect(Number(result.rows[0].volume)).toBeCloseTo(160/47*12/20,12);   // Blank (slot 40) is not counted: 47 measured, not 48 (Owner 2026-11-07)
 expect(Number(result.total)).toBeCloseTo(96,12);
 expect(result.desired).toBe('576');
 expect(Number(result.buffer)).toBeCloseTo(480,12);
 expect(calculateOwnerPooling(master,rows).desired).toBe('768');
 for(const amount of ['0','-1','NaN',''])expect(()=>calculateOwnerPooling(master,rows,amount)).toThrow();
});

it('writes the new pooling columns without overwriting calculated totals with QC2 inputs',()=>{
 const values={'pool.amount':12,'pool.date':'07/11/2569','pool.operator':'SYNTHETIC OPERATOR','pool.standard1':1,'pool.standard2':2,'pool.standard2Concentration':9.9,'slot.1.libraryQc':20,'slot.1.printedSampleId':'SYNTHETIC-1'};
 const generated=generateTaskWorkbook(master,values),parts=readArchive(generated.bytes);
 const sheet=parts.get('xl/worksheets/sheet5.xml')!.toString();
 const cell=(ref:string)=>new RegExp(`<c\\b[^>]*\\br="${ref}"[^>]*>([\\s\\S]*?)</c>`).exec(sheet)?.[1];
 expect(cell('C6')).toContain('<v>12</v>');
 expect(cell('A6')).toMatch(/<v>\d+<\/v>/);
 expect(cell('D3')).toContain('07/11/2569');expect(cell('F3')).toContain('SYNTHETIC OPERATOR');
 expect(cell('A8')).toContain('<v>1</v>');expect(cell('A55')).toContain('<v>48</v>');
 expect(cell('B8')).toContain("'Ext. &amp; Prep. Task List 1'!$B$8");
 expect(cell('C8')).toContain(`160/COUNTA('QC measurements'!$C$7:$C$54)*$C$6/'QC measurements'!C7`);
 expect(cell('C55')).toContain("/'QC measurements'!C54");
 expect(cell('D8')).toContain('<f>SUM(C8:C55)</f>');expect(cell('D10')).toContain('<f>48*C6</f>');expect(cell('D12')).toContain('<f>D10-D8</f>');
 expect(cell('E8')).toContain('1');expect(cell('E10')).toContain('2');
 expect(sheet).toContain('AND(ISNUMBER($C8),$C8&lt;2)');
 expect(parts.get('xl/calcChain.xml')!.toString()).toContain('<c r="C8" i="5"/>');
 expect(parts.get('xl/calcChain.xml')!.toString()).toContain('<c r="B25" i="4"/>');
 expect(parts.get('xl/workbook.xml')!.toString()).toContain("'Pooling Table'!$A$1:$G$55");
 expect(inspectTaskMaster(master).bindings.find(b=>b.key==='pool.dilutionC1')?.cell).toBe('E52');
 for(const amount of [0,-1,Infinity])expect(()=>validateTaskValues(master,{'pool.amount':amount})).toThrow();
});
