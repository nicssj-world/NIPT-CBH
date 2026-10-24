/** Owner-approved fitting applies only to filled text cells. Original styles/fonts remain byte-for-byte intact. */
export function textFitStyles(parts:Map<string,Buffer>){
 const path='xl/styles.xml',original=parts.get(path)!.toString(),block=/<cellXfs\b([^>]*)>([\s\S]*?)<\/cellXfs>/.exec(original);
 if(!block)throw new Error('TASK_CELL_STYLES_REQUIRED');
 const styles=[...block[2].matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map(m=>m[0]),added:string[]=[],indexes=new Map<string,number>();
 return {
  style(index:number,singleLine=false){
   const key=`${index}:${singleLine}`;
   if(indexes.has(key))return indexes.get(key)!;
   const source=styles[index];if(!source)throw new Error('TASK_CELL_STYLE_INVALID');
   let fitted=source.replace(/\s+applyAlignment="[^"]*"/g,'').replace('<xf','<xf applyAlignment="1"');
   if(/<alignment\b/.test(fitted))fitted=fitted.replace(/<alignment\b([^>]*?)\/>/,(_,attrs:string)=>`<alignment${attrs.replace(/\s+shrinkToFit="[^"]*"/g,'')} shrinkToFit="1"/>`);
   else fitted=fitted.endsWith('/>')?fitted.slice(0,-2)+'><alignment shrinkToFit="1"/></xf>':fitted.replace('</xf>','<alignment shrinkToFit="1"/></xf>');
   // Task reagent LOT/EXP must remain visible in the fixed one-line source cell.
   // Excel ignores shrinkToFit when wrapText is on; only the derived metadata style disables wrapping.
   if(singleLine)fitted=fitted.replace(/\s+wrapText="[^"]*"/g,'');
   const next=styles.length+added.length;added.push(fitted);indexes.set(key,next);return next;
  },
  finish(){if(!added.length)return false;const attrs=block[1].replace(/\bcount="\d+"/,`count="${styles.length+added.length}"`);parts.set(path,Buffer.from(original.replace(block[0],`<cellXfs${attrs}>${block[2]}${added.join('')}</cellXfs>`)));return true;},
 };
}
