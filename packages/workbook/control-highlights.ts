/** Owner-approved derivative-only fills. Original style definitions and all cell content stay intact. */
export const CONTROL_HIGHLIGHTS=[
 {sheet:1,slot:1,row:8,columns:'BCDEFG',argb:'FFFFC7CE'},
 {sheet:2,slot:25,row:8,columns:'HIJKLM',argb:'FFDDEBF7'},
 {sheet:3,slot:40,row:15,columns:'BCDEFG',argb:'FFE7E6E6'},
] as const;
export function highlightControls(parts:Map<string,Buffer>,urgent40=false):string[]{
 const path='xl/styles.xml',original=parts.get(path)!.toString();
 const fills=/<fills\b([^>]*)>([\s\S]*?)<\/fills>/.exec(original),xfs=/<cellXfs\b([^>]*)>([\s\S]*?)<\/cellXfs>/.exec(original);
 if(!fills||!xfs)throw Error('TASK_CONTROL_STYLES_REQUIRED');
 const fillCount=[...fills[2].matchAll(/<fill\b/g)].length,styles=[...xfs[2].matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map(m=>m[0]),added:string[]=[],changed:string[]=[];
 for(const [index,control]of CONTROL_HIGHLIGHTS.entries()){
  if(urgent40&&control.slot===40)continue;
  const name=`xl/worksheets/sheet${control.sheet}.xml`,xml=parts.get(name)!.toString(),indexes=new Map<number,number>();let count=0;
  const generated=xml.replace(/<c\b([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g,(cell,attrs:string)=>{
   const ref=/\br="([A-Z]+)(\d+)"/.exec(attrs);if(!ref||Number(ref[2])!==control.row||!control.columns.split('').includes(ref[1]))return cell;
   count++;const sourceIndex=Number(/\bs="(\d+)"/.exec(attrs)?.[1]??0);let next=indexes.get(sourceIndex);
   if(next===undefined){const source=styles[sourceIndex];if(!source)throw Error('TASK_CONTROL_STYLE_INVALID');next=styles.length+added.length;added.push(source.replace(/\bfillId="\d+"/,`fillId="${fillCount+index}"`).replace(/\s+applyFill="[^"]*"/g,'').replace('<xf','<xf applyFill="1"'));indexes.set(sourceIndex,next);}
   const updated=/\bs="\d+"/.test(attrs)?attrs.replace(/\bs="\d+"/,`s="${next}"`):attrs+` s="${next}"`;return cell.replace('<c'+attrs,'<c'+updated);
  });
  if(count!==6)throw Error('TASK_CONTROL_RANGE_INVALID');parts.set(name,Buffer.from(generated));changed.push(name);
 }
 const newFills=CONTROL_HIGHLIGHTS.map(c=>`<fill><patternFill patternType="solid"><fgColor rgb="${c.argb}"/><bgColor indexed="64"/></patternFill></fill>`).join('');
 const attrs=(s:string,count:number)=>s.replace(/\bcount="\d+"/,`count="${count}"`);
 parts.set(path,Buffer.from(original.replace(fills[0],`<fills${attrs(fills[1],fillCount+3)}>${fills[2]}${newFills}</fills>`).replace(xfs[0],`<cellXfs${attrs(xfs[1],styles.length+added.length)}>${xfs[2]}${added.join('')}</cellXfs>`)));
 return [...changed,path];
}
