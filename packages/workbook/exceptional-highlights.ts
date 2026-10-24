/** Derivative-only red font for exceptional analytical identifiers; no value, formula or original style is edited. */
export function highlightExceptionalIds(parts:Map<string,Buffer>,targets:{sheet:number;cell:string}[]):string[]{
 if(!targets.length)return [];
 const path='xl/styles.xml',original=parts.get(path)!.toString();
 const fonts=/<fonts\b([^>]*)>([\s\S]*?)<\/fonts>/.exec(original),xfs=/<cellXfs\b([^>]*)>([\s\S]*?)<\/cellXfs>/.exec(original);
 if(!fonts||!xfs)throw Error('TASK_EXCEPTION_STYLES_REQUIRED');
 const sourceFonts=[...fonts[2].matchAll(/<font\b[^>]*>[\s\S]*?<\/font>/g)].map(m=>m[0]);
 const styles=[...xfs[2].matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map(m=>m[0]);
 const addedFonts:string[]=[],addedStyles:string[]=[],styleIndexes=new Map<number,number>(),fontIndexes=new Map<number,number>(),changed=new Set<string>();
 for(const target of targets){
  const name=`xl/worksheets/sheet${target.sheet}.xml`,xml=parts.get(name)?.toString();if(!xml)throw Error('TASK_EXCEPTION_SHEET_REQUIRED');
  let found=false;
  const updated=xml.replace(/<c\b([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g,(cell,attrs:string)=>{
   if(/\br="([A-Z]+\d+)"/.exec(attrs)?.[1]!==target.cell)return cell;
   found=true;const index=Number(/\bs="(\d+)"/.exec(attrs)?.[1]??0);let next=styleIndexes.get(index);
   if(next===undefined){
    const style=styles[index];if(!style)throw Error('TASK_EXCEPTION_STYLE_INVALID');
    const fontId=Number(/\bfontId="(\d+)"/.exec(style)?.[1]??0);let red=fontIndexes.get(fontId);
    if(red===undefined){const font=sourceFonts[fontId];if(!font)throw Error('TASK_EXCEPTION_FONT_INVALID');red=sourceFonts.length+addedFonts.length;addedFonts.push(font.replace(/<color\b[^>]*(?:\/>|>[\s\S]*?<\/color>)/g,'').replace('</font>','<color rgb="FFFF0000"/></font>'));fontIndexes.set(fontId,red);}
    next=styles.length+addedStyles.length;addedStyles.push(style.replace(/\bfontId="\d+"/,`fontId="${red}"`).replace(/\s+applyFont="[^"]*"/g,'').replace('<xf','<xf applyFont="1"'));styleIndexes.set(index,next);
   }
   const nextAttrs=/\bs="\d+"/.test(attrs)?attrs.replace(/\bs="\d+"/,`s="${next}"`):attrs+` s="${next}"`;
   return cell.replace('<c'+attrs,'<c'+nextAttrs);
  });
  if(!found)throw Error('TASK_EXCEPTION_CELL_REQUIRED');parts.set(name,Buffer.from(updated));changed.add(name);
 }
 const count=(attrs:string,n:number)=>attrs.replace(/\bcount="\d+"/,`count="${n}"`);
 parts.set(path,Buffer.from(original.replace(fonts[0],`<fonts${count(fonts[1],sourceFonts.length+addedFonts.length)}>${fonts[2]}${addedFonts.join('')}</fonts>`).replace(xfs[0],`<cellXfs${count(xfs[1],styles.length+addedStyles.length)}>${xfs[2]}${addedStyles.join('')}</cellXfs>`)));
 return [...changed,path];
}
