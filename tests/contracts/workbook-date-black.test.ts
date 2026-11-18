import {it,expect} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import {generateTaskWorkbook} from '../../packages/workbook/master';
import {readArchive} from '../../packages/workbook/archive';
import {applyPoolingLayout} from '../../packages/workbook/pooling-layout';

// Owner 2026-11-18: the work date on the printed worksheets is black. The master gives the Seq date (sheet 6 B4) a light grey
// font and the QC date (sheet 4 D3) a near-white one; only the colour changes, size, weight and face stay as in the master.
const DATE_CELLS=[[1,'B4'],[2,'B4'],[3,'B4'],[4,'D3'],[5,'D3'],[6,'B4']] as const;
const source=process.env.NIPT_TASK_MASTER_PATH??'.local/lab-owner-evidence/lab-combined-master.xlsx';
const fontOf=(parts:Map<string,Buffer>,sheet:number,cell:string)=>{
 const styles=parts.get('xl/styles.xml')!.toString(),xml=parts.get(`xl/worksheets/sheet${sheet}.xml`)!.toString();
 const fonts=[.../<fonts\b[^>]*>([\s\S]*?)<\/fonts>/.exec(styles)![1].matchAll(/<font\b[^>]*>[\s\S]*?<\/font>|<font\/>/g)].map(m=>m[0]);
 const xfs=[.../<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)![1].matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map(m=>m[0]);
 const i=xml.indexOf(` r="${cell}"`),tag=xml.slice(xml.lastIndexOf('<c ',i),xml.indexOf('>',i)+1);
 return fonts[Number(/fontId="(\d+)"/.exec(xfs[Number(/\bs="(\d+)"/.exec(tag)?.[1]??0)])![1])];
};
it.skipIf(!process.env.NIPT_TASK_MASTER_PATH&&!existsSync(source))('every work-date cell prints in black, keeping the master font otherwise',()=>{
 const master=readFileSync(source),before=readArchive(master);applyPoolingLayout(before);   // generated files carry the versioned Pooling layout
 const after=readArchive(generateTaskWorkbook(master,{'seq.date':'19/11/2569','qc.date':'19/11/2569'}).bytes);
 expect(fontOf(before,6,'B4')).not.toContain('FF000000');   // the master really is grey here
 for(const [sheet,cell] of DATE_CELLS){
  const font=fontOf(after,sheet,cell);
  expect(font,`sheet${sheet}!${cell}`).toContain('<color rgb="FF000000"/>');expect(font).not.toMatch(/theme="0"|tint=/);
  const strip=(f:string)=>f.replace(/<color\b[^>]*(?:\/>|>[\s\S]*?<\/color>)/g,'');
  expect(strip(font)).toBe(strip(fontOf(before,sheet,cell)));
 }
});
