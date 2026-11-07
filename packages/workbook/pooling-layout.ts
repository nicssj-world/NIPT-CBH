/** Versioned derivative of the integrity-checked master: insert Barcode column A.
 * The original master and its pinned hash remain immutable. */
export const POOLING_LAYOUT_VERSION='barcode-column-v1';
const column=(name:string)=>{let n=0;for(const c of name)n=n*26+c.charCodeAt(0)-64;n++;let out='';while(n){n--;out=String.fromCharCode(65+n%26)+out;n=Math.floor(n/26);}return out;};
const shift=(refs:string)=>refs.replace(/(\$?)([A-Z]+)(\$?\d+)/g,(_,a,c,r)=>a+column(c)+r);
function formula(text:string){
 // QC coordinates belong to another sheet and must never move with Pooling.
 const external:string[]=[];
 return shift(text.replace(/'[^']+'!\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?/g,ref=>{external.push(ref);return `@${external.length-1}@`;})).replace(/@(\d+)@/g,(_,i)=>external[Number(i)]);
}
export function applyPoolingLayout(parts:Map<string,Buffer>){
 const path='xl/worksheets/sheet5.xml';let xml=parts.get(path)!.toString();
 xml=xml.replace(/\b(r|ref|sqref|activeCell|topLeftCell)="([A-Z$][A-Z$0-9: ]*)"/g,(_,key,refs)=>`${key}="${shift(refs)}"`)
  .replace(/<f\b([^>]*)>([\s\S]*?)<\/f>/g,(_,attrs,text)=>`<f${attrs}>${formula(text)}</f>`)
  .replace(/<formula>([\s\S]*?)<\/formula>/g,(_,text)=>`<formula>${formula(text)}</formula>`)
  .replace(/\b(min|max)="(\d+)"/g,(_,key,n)=>`${key}="${Math.min(16384,Number(n)+1)}"`)
  .replace('<cols>','<cols><col min="1" max="1" width="9" customWidth="1"/>')
  .replace(/(<col min="7" max="7" width=")[^"]+/, (_,prefix)=>prefix+'19.140625')
  .replace(/(<pageMargins\b[^>]*\bleft=")[^"]+(" right=")[^"]+/, (_,a,b)=>a+'0.25'+b+'0.25')
  // The additional column needs the existing renderer's 62% A4 coordinate scale.
  .replace(/(<pageSetup\b[^>]*\bscale=")\d+/, (_,prefix)=>prefix+'62')
  .replace('<pageSetup ', '<pageSetup paperSize="9" ')
  .replace(/<dimension ref="B1:/,'<dimension ref="A1:')
  .replace(/(<row\b[^>]*\br="(\d+)"[^>]*>)([\s\S]*?)(<\/row>)/g,(all,start,row,body,end)=>{
   const n=Number(row),style=new RegExp(`<c r="B${n}"[^>]*\\bs="(\\d+)"`).exec(body)?.[1]??'19';
   const barcode=n<=5?`<c r="A${n}" s="${style}"/>`:n===7?`<c r="A7" s="${style}" t="inlineStr"><is><t>Barcode</t></is></c>`:n>=8&&n<=55?`<c r="A${n}" s="${style}"><v>${n-7}</v></c>`:'';
   return start+barcode+body+end;
  });
 // Extend the heading across the new column and give the entered date the
 // same visible text style as the operator (the old date placeholder is white).
 xml=xml.replace('r="B6"','r="A6"').replace('ref="B1:B5"','ref="A1:B5"').replace(/<mergeCells count="(\d+)">/,(_,n)=>`<mergeCells count="${Number(n)+1}"><mergeCell ref="A6:B6"/>`);
 const operatorStyle=/<c r="F3"[^>]*\bs="(\d+)"/.exec(xml)?.[1];
 if(operatorStyle)xml=xml.replace(/(<c r="D3"[^>]*\bs=")\d+/,(_,prefix)=>prefix+operatorStyle);
 parts.set(path,Buffer.from(xml));
 const book='xl/workbook.xml';
 const printArea='<definedName name="_xlnm.Print_Area" localSheetId="4">\'Pooling Table\'!$A$1:$G$55</definedName>';
 const workbook=parts.get(book)!.toString().replace(/<definedName\b[^>]*name="_xlnm.Print_Area"[^>]*localSheetId="4"[^>]*>[\s\S]*?<\/definedName>/g,'');
 parts.set(book,Buffer.from(workbook.replace('</definedNames>',printArea+'</definedNames>')));
 // Keep the embedded equipment image aligned with the inserted column.
 const rels=parts.get('xl/worksheets/_rels/sheet5.xml.rels')?.toString()??'';
 const changed=[path,book];
 for(const m of rels.matchAll(/Target="\.\.\/((?:owner-approved\/)?drawings\/[^"/]+\.xml)"/g)){
  const name='xl/'+m[1],drawing=parts.get(name);if(!drawing)continue;
  parts.set(name,Buffer.from(drawing.toString().replace(/<xdr:col>(\d+)<\/xdr:col>/g,(_,n)=>`<xdr:col>${Number(n)+1}</xdr:col>`)));changed.push(name);
 }
 const chain=parts.get('xl/calcChain.xml');
 if(chain){let sheetId='';parts.set('xl/calcChain.xml',Buffer.from(chain.toString().replace(/<c\b[^>]*\/>/g,cell=>{
  sheetId=/\bi="(\d+)"/.exec(cell)?.[1]??sheetId;
  return sheetId==='5'?cell.replace(/\br="([A-Z]+\d+)"/,(_,ref)=>`r="${shift(ref)}"`):cell;
 })));changed.push('xl/calcChain.xml');}
 return changed;
}
