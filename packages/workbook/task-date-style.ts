/** LAB-07: only the work-date caption/value get a black bold clone of their existing font. */
export function styleTaskWorkDates(parts:Map<string,Buffer>){
 const path='xl/styles.xml';let styles=parts.get(path)!.toString();
 const fonts=/<fonts\b[^>]*>([\s\S]*?)<\/fonts>/.exec(styles)!,xfs=/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)!;
 const fontList=[...fonts[1].matchAll(/<font\b[^>]*>[\s\S]*?<\/font>/g)].map(m=>m[0]),xfList=[...xfs[1].matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map(m=>m[0]);
 const clones=new Map<number,number>();
 for(let n=1;n<=3;n++){
  const name=`xl/worksheets/sheet${n}.xml`;let xml=parts.get(name)!.toString();
  for(const ref of ['A4','B4'])xml=xml.replace(new RegExp(`<c\\b([^>]*\\br="${ref}"[^>]*)(?:/>|>([\\s\\S]*?)</c>)`),(all,attrs:string,body:string)=>{
   const old=Number(/\bs="(\d+)"/.exec(attrs)?.[1]??0);let next=clones.get(old);
   if(next===undefined){const xf=xfList[old],fontId=Number(/fontId="(\d+)"/.exec(xf)![1]);const font=fontList[fontId].replace(/<b\b[^>]*(?:\/>|>[\s\S]*?<\/b>)/g,'').replace(/<color\b[^>]*\/>/g,'').replace('</font>','<b/><color rgb="FF000000"/></font>');const id=fontList.push(font)-1;next=xfList.push(xf.replace(/fontId="\d+"/,`fontId="${id}"`).replace(/\s+applyFont="[^"]*"/g,'').replace('<xf','<xf applyFont="1"'))-1;clones.set(old,next);}
   const updated=/\bs="\d+"/.test(attrs)?attrs.replace(/\bs="\d+"/,`s="${next}"`):attrs+` s="${next}"`;
   if(ref==='A4')return `<c${updated.replace(/\s+t="[^"]*"/g,'')} t="inlineStr"><is><t>ว/ด/ป ที่ปฏิบัติงาน</t></is></c>`;
   return `<c${updated}>${body??''}</c>`;
  });
  parts.set(name,Buffer.from(xml));
 }
 styles=styles.replace(fonts[0],`<fonts count="${fontList.length}">${fontList.join('')}</fonts>`).replace(xfs[0],`<cellXfs count="${xfList.length}">${xfList.join('')}</cellXfs>`);parts.set(path,Buffer.from(styles));
 return ['xl/styles.xml',...Array.from({length:3},(_,i)=>`xl/worksheets/sheet${i+1}.xml`)];
}
