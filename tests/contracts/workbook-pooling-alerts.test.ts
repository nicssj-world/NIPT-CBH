import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {generateTaskWorkbook} from '../../packages/workbook/master';
import {readArchive} from '../../packages/workbook/archive';
const master=readFileSync('.local/lab-owner-evidence/lab-combined-master.xlsx');
it('native Pooling alerts use actual calculated cells and preserve every original font and formula',()=>{
 const values:Record<string,unknown>={};for(let i=1;i<=48;i++)values[`slot.${i}.libraryQc`]=i===2?30:20;
 const original=readArchive(master),base=original.get('xl/worksheets/sheet5.xml')!.toString();
 for(const concentration of [3,3.6,3.61]){
  const parts=readArchive(generateTaskWorkbook(master,{...values,'pool.concentration':concentration}).bytes),xml=parts.get('xl/worksheets/sheet5.xml')!.toString(),styles=parts.get('xl/styles.xml')!.toString();
  expect(xml).toContain('sqref="A8:B55"');expect(xml).toContain('AND(ISNUMBER($B8),$B8&lt;2)');
  expect(xml).toContain('AND(ISNUMBER(E14),OR(E14&lt;3,E14&gt;3.6))');expect(styles).toContain('<dxf><font><color rgb="FFFF0000"/></font></dxf>');
  expect(/<fonts[^>]*>[\s\S]*?<\/fonts>/.exec(styles)![0]).toBe(/<fonts[^>]*>[\s\S]*?<\/fonts>/.exec(original.get('xl/styles.xml')!.toString())![0]);
  expect([...xml.matchAll(/<f\b[^>]*>[\s\S]*?<\/f>/g)].map(m=>m[0])).toEqual([...base.matchAll(/<f\b[^>]*>[\s\S]*?<\/f>/g)].map(m=>m[0]));
 }
});
