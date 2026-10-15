import {it,expect} from 'vitest';
import {highlightControls} from '../../packages/workbook/control-highlights';

it('applies the three approved Control fills with no owner-file dependency, preserving every other cell and style property',()=>{
 const styles='<styleSheet><fonts count="1"><font><name val="TH Sarabun New"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="1"/><xf numFmtId="2" fontId="0" fillId="0" borderId="2" applyAlignment="1"><alignment horizontal="center" shrinkToFit="1"/></xf></cellXfs></styleSheet>';
 const parts=new Map<string,Buffer>([['xl/styles.xml',Buffer.from(styles)],['xl/media/logo.png',Buffer.from('unchanged-image')]]);
 for(let sheet=1;sheet<=6;sheet++){
  let rows='';for(let row=7;row<=16;row++)rows+=`<row r="${row}">`+[...'ABCDEFGHIJKLM'].map((col,i)=>`<c r="${col}${row}" s="${i%2}"><v>${sheet*100+row}</v></c>`).join('')+'</row>';
  parts.set(`xl/worksheets/sheet${sheet}.xml`,Buffer.from(`<worksheet><sheetData>${rows}</sheetData><pageSetup paperSize="9" scale="66"/></worksheet>`));
 }
 const before=new Map(parts),changed=highlightControls(parts);
 expect(changed).toEqual(['xl/worksheets/sheet1.xml','xl/worksheets/sheet2.xml','xl/worksheets/sheet3.xml','xl/styles.xml']);
 const xml=parts.get('xl/styles.xml')!.toString(),fills=[.../<fills\b[^>]*>([\s\S]*?)<\/fills>/.exec(xml)![1].matchAll(/<fill>[\s\S]*?<\/fill>/g)].map(m=>m[0]);
 const xfs=(s:string)=>[.../<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(s)![1].matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map(m=>m[0]),originalStyles=xfs(styles),generatedStyles=xfs(xml);
 expect(generatedStyles.slice(0,2)).toEqual(originalStyles);
 const outside=(s:string)=>s.replace(/<fills\b[^>]*>[\s\S]*?<\/fills>/,'').replace(/<cellXfs\b[^>]*>[\s\S]*?<\/cellXfs>/,'');expect(outside(xml)).toBe(outside(styles));
 const targets=[['BCDEFG',8,'FFFFC7CE'],['HIJKLM',8,'FFDDEBF7'],['BCDEFG',15,'FFE7E6E6']] as const;
 for(let sheet=1;sheet<=6;sheet++){
  const name=`xl/worksheets/sheet${sheet}.xml`,a=before.get(name)!.toString(),b=parts.get(name)!.toString();
  const cells=(s:string)=>new Map([...s.matchAll(/<c\b[^>]*>[\s\S]*?<\/c>/g)].map(m=>[/\br="([^"]+)"/.exec(m[0])![1],m[0]]));const actual=cells(b);let coloured=0;
  for(const [ref,cell]of cells(a)){
   const target=sheet<=3&&targets[sheet-1][0].split('').some(col=>ref===col+targets[sheet-1][1]);const derived=actual.get(ref)!;
   if(!target){expect(derived,`${sheet}!${ref}`).toBe(cell);continue;}
   coloured++;expect(derived.replace(/\bs="\d+"/,''),ref).toBe(cell.replace(/\bs="\d+"/,''));
   const style=generatedStyles[Number(/\bs="(\d+)"/.exec(derived)![1])];expect(fills[Number(/\bfillId="(\d+)"/.exec(style)![1])]).toContain(`rgb="${targets[sheet-1][2]}"`);
   expect(style.replace(/\s+applyFill="1"/,'').replace(/\bfillId="\d+"/,'fillId="0"')).toBe(originalStyles[Number(/\bs="(\d+)"/.exec(cell)![1])]);
  }
  expect(coloured).toBe(sheet<=3?6:0);
  const strip=(s:string)=>s.replace(/<c\b[^>]*>[\s\S]*?<\/c>/g,'');expect(strip(b)).toBe(strip(a));
 }
 expect(parts.get('xl/media/logo.png')).toBe(before.get('xl/media/logo.png'));
});
