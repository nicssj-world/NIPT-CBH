import {it,expect} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import manifest from '../../packages/workbook/master-manifest.json';
import {inspectTaskMaster,generateTaskWorkbook,MASTER_SHA256} from '../../packages/workbook/master';
import {readArchive,sha256} from '../../packages/workbook/archive';
import {poolDilutionReady} from '../../packages/workbook/dilution';
const source=process.env.NIPT_TASK_MASTER_PATH??'C:/Users/User/Downloads/NIPT_CBH_Final_Combined_Master_2026-10-15.xlsx';
it('D52 readiness distinguishes absent, zero, negative and positive concentrations without rewriting Excel formulas',()=>{
 for(const value of [undefined,null,0,-1,NaN,Infinity,'10'])expect(poolDilutionReady({'pool.dilutionC1':value})).toBe(false);
 expect(poolDilutionReady({'pool.dilutionC1':10})).toBe(true);
});
it.skipIf(!existsSync(source))('owner F52 exception changes exactly the approved worksheet XML; manifest layout, media and 149 formulas remain intact',()=>{
 const master=readFileSync(source),parts=readArchive(master);expect(sha256(master)).toBe(MASTER_SHA256);expect(MASTER_SHA256).toBe(manifest.sha256);
 for(const s of manifest.sheets)expect(sha256(parts.get(`xl/worksheets/sheet${s.index}.xml`)!)).toBe(s.sheet_xml_sha256);
 expect(sha256(parts.get('xl/styles.xml')!)).toBe(manifest.styles_xml_sha256);
 for(const m of manifest.media)expect(sha256(parts.get(m.path)!)).toBe(m.sha256);
 const pool=parts.get('xl/worksheets/sheet5.xml')!.toString();
 expect(pool).toMatch(/<c\b[^>]*r="F52"[^>]*><f>\(D54\*F54\)\/D52<\/f>/);
 expect(pool).toContain('<f>F54-F52</f>');expect(inspectTaskMaster(master).formulaCount).toBe(149);
 const binding=inspectTaskMaster(master).bindings.find(b=>b.key==='pool.dilutionC1');expect(binding).toMatchObject({cell:'D52',sheet:'Pooling Table',editable:true,dataType:'number'});
 const filled=readArchive(generateTaskWorkbook(master,{'pool.dilutionC1':10}).bytes);
 expect(filled.get('xl/worksheets/sheet5.xml')!.toString()).toMatch(/<c r="D52"[^>]*><v>10<\/v><\/c>/);
 for(const [name,bytes]of parts)if(name.startsWith('xl/worksheets/'))expect([...filled.get(name)!.toString().matchAll(/<f\b[^>]*>[\s\S]*?<\/f>/g)].map(m=>m[0])).toEqual([...bytes.toString().matchAll(/<f\b[^>]*>[\s\S]*?<\/f>/g)].map(m=>m[0]));
});
