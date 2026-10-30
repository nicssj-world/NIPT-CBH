import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {generateTaskWorkbook,MASTER_SHA256,SHEETS} from '../../packages/workbook/master';
import {readArchive,sha256} from '../../packages/workbook/archive';
it('exceptional Task identifiers use derivative red fonts with unchanged six sheets, formulas and source master',()=>{
 const master=readFileSync('.local/lab-owner-evidence/lab-combined-master.xlsx');
 const values={'slot.2.printedSampleId':'26B261023001R-1','slot.17.printedSampleId':'26B261023001R-1','slot.33.printedSampleId':'26B261023002DR-1'};
 const regular=readArchive(generateTaskWorkbook(master,values).bytes),red=readArchive(generateTaskWorkbook(master,values,{exceptionalSlots:[2,17,33]}).bytes);
 const styles=red.get('xl/styles.xml')!.toString(),fonts=[.../<fonts\b[^>]*>([\s\S]*?)<\/fonts>/.exec(styles)![1].matchAll(/<font\b[^>]*>[\s\S]*?<\/font>/g)].map(m=>m[0]),xfs=[.../<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)![1].matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map(m=>m[0]);
 for(const [sheet,ref]of [[1,'B9'],[2,'B8'],[3,'B8']] as const){
  const name=`xl/worksheets/sheet${sheet}.xml`,cell=new RegExp(`<c\\b[^>]*r="${ref}"[^>]*>[\\s\\S]*?</c>`).exec(red.get(name)!.toString())![0];
  const style=xfs[Number(/\bs="(\d+)"/.exec(cell)![1])];expect(fonts[Number(/\bfontId="(\d+)"/.exec(style)![1])]).toContain('rgb="FFFF0000"');
  expect(red.get(name)!.toString().replace(/\bs="\d+"/g,'' )).toBe(regular.get(name)!.toString().replace(/\bs="\d+"/g,''));
 }
 let formulas=0;for(let n=1;n<=6;n++){const name=`xl/worksheets/sheet${n}.xml`,a=regular.get(name)!.toString(),b=red.get(name)!.toString(),f=(x:string)=>[...x.matchAll(/<f\b[^>]*>[\s\S]*?<\/f>/g)].map(m=>m[0]);expect(f(b)).toEqual(f(a));formulas+=f(b).length;}
 expect(formulas).toBe(149);expect(SHEETS).toHaveLength(6);expect(sha256(master)).toBe(MASTER_SHA256);
});
