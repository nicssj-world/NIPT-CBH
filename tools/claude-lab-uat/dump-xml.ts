import {readFileSync} from 'node:fs';
import {readArchive} from '../../packages/workbook/archive';
const p=readArchive(readFileSync('.local/task3-sources/singleton.docx'));
const x=p.get('word/document.xml')!.toString('utf8'),h=p.get('word/header1.xml')!.toString('utf8');
const texts=[...x.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map(m=>m[1]);
console.log(texts.filter(t=>/Report|by:|hn|^ga$|\$|^\{|\}$/.test(t)).slice(0,60).map(t=>JSON.stringify(t)).join(' '));
console.log('HEADER',[...h.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map(m=>JSON.stringify(m[1])).join(' '));
console.log('sectPr',x.lastIndexOf('<w:sectPr'),x.indexOf('<w:body>'));
