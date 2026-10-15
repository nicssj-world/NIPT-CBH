import {it,expect} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import {composeOwnerMaster} from '../../tools/operational/compose-owner-master';
import {readArchive,sha256} from '../../packages/workbook/archive';
import {MASTER_SHA256,inspectTaskMaster} from '../../packages/workbook/master';
const locked='C:/Users/User/Downloads/Final_New_Task_List_Edit_2_F52_Corrected.xlsx',owner='C:/Users/User/OneDrive/Desktop/Scale Final New_Task_List_Edit (2).xlsx';
it.skipIf(!existsSync(locked)||!existsSync(owner))('reproducibly composes owner sheets with byte-identical locked Task Lists and all original 149 formulas',()=>{
 const base=readFileSync(locked),revision=readFileSync(owner),result=composeOwnerMaster(base,revision),before=readArchive(base),after=readArchive(result.bytes);
 expect(sha256(result.bytes)).toBe(MASTER_SHA256);expect(inspectTaskMaster(result.bytes).formulaCount).toBe(149);
 for(let i=1;i<=6;i++){
  const name=`xl/worksheets/sheet${i}.xml`,original=before.get(name)!;
  if(i<=3)expect(after.get(name)!.equals(original)).toBe(true);
  const formulas=(bytes:Buffer)=>[...bytes.toString().matchAll(/<f\b[^>]*>[\s\S]*?<\/f>/g)].map(m=>m[0]);expect(formulas(after.get(name)!)).toEqual(formulas(original));
 }
 for(const [name,bytes]of before)if(name.startsWith('xl/drawings/')||name.startsWith('xl/media/')||name.startsWith('xl/printerSettings/'))expect(after.get(name)!.equals(bytes),name).toBe(true);
 expect(result.evidence.restoredCrossSheetReferences).toHaveLength(96);
 expect(()=>composeOwnerMaster(Buffer.from('wrong'),revision)).toThrow();expect(()=>composeOwnerMaster(base,Buffer.from('wrong'))).toThrow();
});
