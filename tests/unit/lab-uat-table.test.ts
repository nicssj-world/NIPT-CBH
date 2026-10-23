import {it,expect} from 'vitest';
import {parseXlsx,templateXlsx} from '../../packages/historical/table';
import {readArchive,writeArchive} from '../../packages/workbook/archive';
it('LAB-UAT-005/015 provides import and guide sheets; ignores guide and preserves numeric identifiers and physical rows',()=>{
 const parts=readArchive(templateXlsx());
 expect(parts.get('xl/workbook.xml')!.toString()).toContain('คำอธิบาย');
 let sheet=parts.get('xl/worksheets/sheet1.xml')!.toString();
 sheet=sheet.replace('</sheetData>','<row r="5"><c r="A5"><v>45000</v></c><c r="B5" t="inlineStr"><is><t>000123</t></is></c><c r="C5" t="inlineStr"><is><t>SYNTHETIC TEST</t></is></c><c r="L5" t="inlineStr"><is><t>cabinet</t></is></c></row></sheetData>');
 parts.set('xl/worksheets/sheet1.xml',Buffer.from(sheet));
 const parsed=parseXlsx(writeArchive(parts));
 expect(parsed.rows).toHaveLength(1);expect(parsed.rows[0]).toMatchObject({rowNo:5,cells:{ln:'45000',hn:'000123'}});
});
