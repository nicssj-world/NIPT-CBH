import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {generateTaskWorkbook,MASTER_SHA256} from '../../packages/workbook/master';
import {readArchive,sha256} from '../../packages/workbook/archive';

it('highlights only PC1, NC25 and BLANK40 in generated files, preserving master, formulas and every other cell',()=>{
 const master=readFileSync(process.env.NIPT_TASK_MASTER_PATH??'C:/Users/User/Downloads/NIPT_CBH_Final_Combined_Master_2026-10-15.xlsx');
 const before=readArchive(master),after=readArchive(generateTaskWorkbook(master,{}).bytes);
 const styles=after.get('xl/styles.xml')!.toString();
 const fills=[.../<fills\b[^>]*>([\s\S]*?)<\/fills>/.exec(styles)![1].matchAll(/<fill>[\s\S]*?<\/fill>/g)].map(m=>m[0]);
 const xfs=[.../<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)![1].matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map(m=>m[0]);
 const cells=(x:string)=>new Map([...x.matchAll(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)].map(m=>[/\br="([^"]+)"/.exec(m[0])![1],m[0]]));
 const targets=[['BCDEFG',8,'FFFFC7CE'],['HIJKLM',8,'FFDDEBF7'],['BCDEFG',15,'FFE7E6E6']] as const;
 for(let i=1;i<=6;i++){
  const name=`xl/worksheets/sheet${i}.xml`,a=before.get(name)!.toString(),b=after.get(name)!.toString(),ca=cells(a),cb=cells(b);
  expect([...a.matchAll(/<f\b[^>]*>[\s\S]*?<\/f>/g)].map(m=>m[0])).toEqual([...b.matchAll(/<f\b[^>]*>[\s\S]*?<\/f>/g)].map(m=>m[0]));
  for(const [ref,cell]of ca){
   const target=i<=3&&targets[i-1][0].split('').some(col=>ref===col+targets[i-1][1]);
   if(target){const derived=cb.get(ref)!;expect(derived.replace(/\bs="\d+"/,'')).toBe(cell.replace(/\bs="\d+"/,''));const style=xfs[Number(/\bs="(\d+)"/.exec(derived)![1])];expect(fills[Number(/\bfillId="(\d+)"/.exec(style)![1])]).toContain(`rgb="${targets[i-1][2]}"`);}
   else expect(cb.get(ref),name+'!'+ref).toBe(cell);
  }
  const strip=(x:string)=>x.replace(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g,'');expect(strip(b)).toBe(strip(a));
 }
 expect(sha256(master)).toBe(MASTER_SHA256);
 for(const [name,bytes]of before)if(name!=='xl/styles.xml'&&!/^xl\/worksheets\/sheet[123]\.xml$/.test(name))expect(after.get(name)!.equals(bytes),name).toBe(true);
});
