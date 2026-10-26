// Dumps text items (with positions) and image paint ops of a PDF page via the repo's pdfjs-dist; usage: node pdf-inspect.mjs file.pdf
import {readFileSync} from 'node:fs';
const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
const doc=await pdfjs.getDocument({data:new Uint8Array(readFileSync(process.argv[2])),useSystemFonts:true}).promise;
const page=await doc.getPage(1);const vp=page.getViewport({scale:1});console.log('pages',doc.numPages,'size',vp.width,vp.height);
const tc=await page.getTextContent();
const items=tc.items.filter(i=>i.str.trim()).map(i=>({s:i.str,x:Math.round(i.transform[4]),y:Math.round(vp.height-i.transform[5])}));
console.log(items.filter(i=>/Report|Approv|no\.|Date|\(/i.test(i.s)).map(i=>`${i.x},${i.y} ${i.s}`).join('\n'));
const ops=await page.getOperatorList();const OPS=pdfjs.OPS;let ctm=[1,0,0,1,0,0];const st=[];
const mul=(m,n)=>[m[0]*n[0]+m[2]*n[1],m[1]*n[0]+m[3]*n[1],m[0]*n[2]+m[2]*n[3],m[1]*n[2]+m[3]*n[3],m[0]*n[4]+m[2]*n[5]+m[4],m[1]*n[4]+m[3]*n[5]+m[5]];
for(let i=0;i<ops.fnArray.length;i++){const f=ops.fnArray[i],a=ops.argsArray[i];
 if(f===OPS.save)st.push(ctm);else if(f===OPS.restore)ctm=st.pop()??ctm;else if(f===OPS.transform)ctm=mul(ctm,a);
 else if(f===OPS.paintImageXObject||f===OPS.paintInlineImageXObject||f===OPS.paintImageMaskXObject){console.log('IMG',a[0]?.toString().slice(0,20),'x',Math.round(ctm[4]),'y',Math.round(vp.height-ctm[5]-ctm[3]),'w',Math.round(ctm[0]),'h',Math.round(ctm[3]));}}
