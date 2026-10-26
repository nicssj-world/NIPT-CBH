import {readFileSync} from 'node:fs';
import {templateParts} from '../../packages/readygen/docx';
import {inspectTemplate} from '../../packages/readygen/template-registry';
for(const [kind,f] of [['SINGLETON','singleton.docx'],['TWIN','twin.docx']] as const){
 const b=readFileSync('.local/task3-sources/'+f),t=templateParts(b);
 console.log('==',kind,t.names.length,'parts');
 for(const p of t.parts)console.log(p.part,p.paragraphs.filter(x=>x.trim()).map(x=>x.trim().slice(0,70)).join(' | ').slice(0,900));
 const i=inspectTemplate(kind,b,kind==='TWIN'?'2.FM-WI-T-BM-17-08 HNZ0051-Twin.docx':'1.FM-WI-T-BM-17-07 HNZ0051-Singleton.docx');console.log(JSON.stringify({errors:i.errors,warnings:i.warnings,found:i.found.length,missing:i.missing,product:i.product,code:i.code}));
}
