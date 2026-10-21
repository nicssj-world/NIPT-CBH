import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {readArchive,writeArchive,sha256,xmlDecode,xmlEscape} from '../../packages/workbook/archive';
import {styleTaskWorkDates} from '../../packages/workbook/task-date-style';

export const LOCKED_TASK_SOURCE='2f8aef50243c89eae6a4e9115d65fbf9239754a1bd9ce330205378f3a9b3aacf';
export const OWNER_THREE_SHEET_SOURCE='f4f4126f42a36adeb58c8ed908a39a7b6f19e8cc57e05a1ceb03fa4b12e157ef';
const section=(xml:string,tag:string)=>new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml);
const elements=(xml:string,tag:string)=>[...xml.matchAll(new RegExp(`<${tag}\\b[^>]*?(?:/>|>[\\s\\S]*?</${tag}>)`,'g'))].map(m=>m[0]);
const formulas=(xml:string)=>new Map([...xml.matchAll(/<c\b[^>]*\br="([A-Z]+\d+)"[^>]*>([\s\S]*?)<\/c>/g)].flatMap(m=>{const f=/<f\b[^>]*>[\s\S]*?<\/f>/.exec(m[2]);return f?[[m[1],f[0]] as const]:[];}));
/** Lossless OPC composition: old task sheets stay byte-identical; import owner sheets and their dependencies.
 * References broken by deleting the task sheets are restored exclusively from the locked formula inventory.
 */
export function composeOwnerMaster(locked:Buffer,owner:Buffer) {
 return composeParts(locked,owner,false);
}
export const OWNER_TASK_SOURCE='9e69127a4f162796d43ce04f7c80a5b056053e4b74a061363ad2dd00d95fc821';
/** Owner LAB-13 replacement: task coordinates stay fixed, all QC/Pooling/Seq XML stays byte-identical. */
export function composeTaskReplacement(locked:Buffer,owner:Buffer){return composeParts(locked,owner,true);}
function composeParts(locked:Buffer,owner:Buffer,replaceTasks:boolean) {
 assert.equal(sha256(locked),replaceTasks?'0f94efbc240b9a38ff9be77bf0c8d92c09d82fa2fe2427b9d274cc739e5607a6':LOCKED_TASK_SOURCE);assert.equal(sha256(owner),replaceTasks?OWNER_TASK_SOURCE:OWNER_THREE_SHEET_SOURCE);
 const base=readArchive(locked),incoming=readArchive(owner),out=new Map(base);
 assert.deepEqual([...incoming.get('xl/workbook.xml')!.toString().matchAll(/<sheet\b[^>]*\bname="([^"]+)"/g)].map(m=>xmlDecode(m[1])),replaceTasks?['Ext. & Prep. Task List 1','Ext. & Prep. Task List 2','Ext. & Prep. Task List 3']:['QC measurements','Pooling Table','Seq Task-G50']);
 const strings=section(base.get('xl/sharedStrings.xml')!.toString(),'sst')!,addedStrings=section(incoming.get('xl/sharedStrings.xml')!.toString(),'sst')!;
 const stringOffset=elements(strings[1],'si').length,extraStrings=elements(addedStrings[1],'si');
 out.set('xl/sharedStrings.xml',Buffer.from(base.get('xl/sharedStrings.xml')!.toString().replace(strings[1],strings[1]+extraStrings.join('')).replace(/\b(count|uniqueCount)="\d+"/g,(_,key)=>`${key}="${stringOffset+extraStrings.length}"`)));
 let styles=base.get('xl/styles.xml')!.toString();const newStyles=incoming.get('xl/styles.xml')!.toString();
 const offsets:Record<string,number>={},maps:Record<string,number[]>={},numFormats=new Map<number,number>();
 const existingFormats=elements(section(styles,'numFmts')?.[1]??'','numFmt');let nextFormat=Math.max(163,...existingFormats.map(x=>Number(/numFmtId="(\d+)"/.exec(x)![1])))+1;
 const append=(tag:string,child:string,transform=(s:string)=>s)=>{
  const old=section(styles,tag),added=elements(section(newStyles,tag)?.[1]??'',child);offsets[tag]=elements(old?.[1]??'',child).length;
  if(!added.length)return;
  const original=elements(old?.[1]??'',child),all=[...original];maps[tag]=[];
  for(const item of added){const mapped=transform(item);let index=tag==='numFmts'?-1:all.indexOf(mapped);if(index<0){index=all.length;all.push(mapped);}maps[tag].push(index);}
  const body=all.join(''),replacement=`<${tag} count="${all.length}">${body}</${tag}>`;
  if(old)styles=styles.replace(old[0],replacement);else if(new RegExp(`<${tag}\\b[^>]*/>`).test(styles))styles=styles.replace(new RegExp(`<${tag}\\b[^>]*/>`),replacement);else styles=styles.replace('<fonts',replacement+'<fonts');
 };
 append('numFmts','numFmt',s=>s.replace(/numFmtId="(\d+)"/,(_,id)=>{const mapped=nextFormat++;numFormats.set(Number(id),mapped);return `numFmtId="${mapped}"`;}));
 for(const [tag,child] of [['fonts','font'],['fills','fill'],['borders','border']] as const)append(tag,child);
 const mapXf=(s:string)=>s.replace(/\b(fontId|fillId|borderId|numFmtId|xfId)="(\d+)"/g,(_,key,id)=>`${key}="${key==='numFmtId'?(numFormats.get(Number(id))??Number(id)):(maps[({fontId:'fonts',fillId:'fills',borderId:'borders',xfId:'cellStyleXfs'} as Record<string,string>)[key]]?.[Number(id)]??Number(id))}"`);
 append('cellStyleXfs','xf',mapXf);append('cellXfs','xf',mapXf);
 // Differential styles contain embedded formatting rather than font/fill/border indices.
 append('dxfs','dxf',s=>s.replace(/numFmtId="(\d+)"/g,(_,id)=>`numFmtId="${numFormats.get(Number(id))??Number(id)}"`));
 out.set('xl/styles.xml',Buffer.from(styles));
 const overrides=new Map([...incoming.get('[Content_Types].xml')!.toString().matchAll(/<Override\b[^>]*\bPartName="([^"]+)"[^>]*\bContentType="([^"]+)"[^>]*\/>/g)].map(m=>[m[1].slice(1),m[2]]));
 let types=out.get('[Content_Types].xml')!.toString();const imported=new Set<string>();
 const importPart=(source:string,target:string)=>{
  if(imported.has(source))return;imported.add(source);const bytes=incoming.get(source);assert(bytes,`missing ${source}`);out.set(target,bytes);
  if(overrides.has(source)&&!types.includes(`PartName="/${target}"`))types=types.replace('</Types>',`<Override PartName="/${target}" ContentType="${overrides.get(source)}"/></Types>`);
  const sourceRel=path.posix.join(path.posix.dirname(source),'_rels',path.posix.basename(source)+'.rels');const rel=incoming.get(sourceRel);
  if(rel){const targetRel=path.posix.join(path.posix.dirname(target),'_rels',path.posix.basename(target)+'.rels');
   const rewritten=rel.toString().replace(/<Relationship\b[^>]*\/>/g,element=>{if(element.includes('TargetMode="External"'))return element;const raw=/\bTarget="([^"]+)"/.exec(element)![1];const dep=path.posix.normalize(path.posix.join(path.posix.dirname(source),xmlDecode(raw)));const destination=(replaceTasks?'xl/owner-task-20261021/':'xl/owner-approved/')+dep.replace(/^xl\//,'');importPart(dep,destination);return element.replace(`Target="${raw}"`,`Target="${xmlEscape(path.posix.relative(path.posix.dirname(target),destination))}"`);});
   out.set(targetRel,Buffer.from(rewritten));
  }
 };
 const restored:string[]=[];
 for(let i=1;i<=3;i++){
  const name=`xl/worksheets/sheet${replaceTasks?i:i+3}.xml`,src=`xl/worksheets/sheet${i}.xml`;importPart(src,name);
  const expected=formulas(base.get(name)!.toString());let sheet=out.get(name)!.toString();assert.equal(formulas(sheet).size,expected.size);
  sheet=sheet.replace(/<(c|row|col)\b[^>]*>/g,tag=>tag.replace(/\b(s|style)="(\d+)"/g,(_,key,id)=>`${key}="${maps.cellXfs[Number(id)]}"`));
  sheet=sheet.replace(/\bdxfId="(\d+)"/g,(_,id)=>`dxfId="${maps.dxfs[Number(id)]}"`);
  sheet=sheet.replace(/<c\b[^>]*>[\s\S]*?<\/c>/g,cell=>{
   if(/\bt="s"/.test(cell))cell=cell.replace(/<v>(\d+)<\/v>/,(_,v)=>`<v>${Number(v)+stringOffset}</v>`);
   const ref=/\br="([A-Z]+\d+)"/.exec(cell)![1],f=/<f\b[^>]*>[\s\S]*?<\/f>/.exec(cell);
   if(f){const original=expected.get(ref);assert(original);if(f[0]!==original){assert(f[0].includes('#REF!'),`unapproved formula ${name}!${ref}`);restored.push(`${name}!${ref}`);cell=cell.replace(f[0],original).replace(/\bt="e"/,'').replace(/<v>[\s\S]*?<\/v>/,'');}}
   return cell;
  });
  assert.deepEqual(formulas(sheet),expected);out.set(name,Buffer.from(sheet));
 }
 out.set('[Content_Types].xml',Buffer.from(types));
 // Old calcChain is still valid: identical six-sheet formula coordinates and identities.
 for(let i=1;i<=3;i++){
  const untouched=replaceTasks?i+3:i;
  assert(out.get(`xl/worksheets/sheet${untouched}.xml`)!.equals(base.get(`xl/worksheets/sheet${untouched}.xml`)!));
 }
 if(replaceTasks){
  // Supplied layout includes worked examples. Reset every runtime task binding to a blank, never expose example patient data.
  for(let i=1;i<=3;i++){
   const name=`xl/worksheets/sheet${i}.xml`;let sheet=out.get(name)!.toString();
   const mapped=new Set(['B4','B5','K5','B16','B17',...Array.from({length:16},(_,n)=>`${n<8?'B':'H'}${8+n%8}`),...Array.from({length:16},(_,n)=>`${n<8?'D':'J'}${8+n%8}`),...Array.from({length:16},(_,n)=>`${n<8?'E':'K'}${8+n%8}`)]);
   sheet=sheet.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,(all,attrs)=>mapped.has(/\br="([A-Z]+\d+)"/.exec(attrs)?.[1]??'')?`<c${attrs.replace(/\s+t="[^\"]*"/g,'')} t="inlineStr"><is><t></t></is></c>`:all);
   out.set(name,Buffer.from(sheet));
  }
 }
 if(replaceTasks)styleTaskWorkDates(out);
 const bytes=writeArchive(out);return {bytes,evidence:{sha256:sha256(bytes),bytes:bytes.length,lockedTaskSourceSha256:sha256(locked),ownerThreeSheetSourceSha256:sha256(owner),taskSheetXmlByteIdentical:!replaceTasks,formulaSheetsByteIdentical:replaceTasks,formulaCount:149,restoredCrossSheetReferences:restored,importedParts:[...imported]}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const [locked,owner,destination]=process.argv.slice(2);assert(locked&&owner&&destination,'locked owner destination required');
 const result=composeOwnerMaster(await readFile(locked),await readFile(owner));await writeFile(destination,result.bytes,{flag:'wx'});await writeFile(destination+'.json',JSON.stringify(result.evidence,null,2),{flag:'wx'});process.stdout.write(JSON.stringify(result.evidence)+'\n');
}
