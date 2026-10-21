/** Exact-master verification; never writes the source or changes workbook layout. */
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {generateTaskWorkbook,inspectTaskMaster,MASTER_SHA256,SHEETS} from '../../packages/workbook/master';
import {readArchive,sha256,xmlDecode} from '../../packages/workbook/archive';
import {exportTaskPdfs} from '../../packages/workbook/native-pdf';
import {CONTROL_HIGHLIGHTS} from '../../packages/workbook/control-highlights';

const cellMap=(xml:string)=>new Map([...xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map(m=>[/\br="([A-Z]+\d+)"/.exec(m[1])![1],{attributes:m[1],body:m[2]??'',xml:m[0]}]));
const withoutCache=(xml:string)=>xml.replace(/(<c\b[^>]*>)([\s\S]*?)(<\/c>)/g,(all,start,body,end)=>/<f\b/.test(body)?start+body.replace(/<v\b[^>]*>[\s\S]*?<\/v>/g,'')+end:all);
const ownerAlerts=/<conditionalFormatting sqref="(?:A8:B55|E14)"><cfRule type="expression" dxfId="\d+" priority="\d+"><formula>(?:AND\(ISNUMBER\(\$B8\),\$B8&lt;2\)|AND\(ISNUMBER\(E14\),OR\(E14&lt;3,E14&gt;3\.6\)\))<\/formula><\/cfRule><\/conditionalFormatting>/g;
const texts=(xml:string)=>[...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m=>xmlDecode(m[1])).join('');
const coord=(ref:string)=>{const [,letters,row]=/^([A-Z]+)(\d+)$/.exec(ref)!;return {col:[...letters].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0),row:Number(row)};};
const contains=(range:string,ref:string)=>{const [first,last=first]=range.split(':'),a=coord(first),b=coord(last),c=coord(ref);return c.col>=a.col&&c.col<=b.col&&c.row>=a.row&&c.row<=b.row;};

export function verifyBindingFidelity(master:Buffer) {
  const matrix=inspectTaskMaster(master),before=readArchive(master);
  assert.equal(matrix.masterSha256,MASTER_SHA256);
  assert.equal(matrix.formulaCount,149);
  assert.equal(new Set(matrix.bindings.map(b=>b.key)).size,matrix.bindings.length,'duplicate keys');
  assert.equal(new Set(matrix.bindings.map(b=>`${b.sheet}!${b.cell}`)).size,matrix.bindings.length,'duplicate writable cells');
  const values:Record<string,unknown>={};
  for(const [i,b] of matrix.bindings.entries())values[b.key]=b.dataType==='checkbox'?true:b.dataType==='number'?10+(i+1)/1000:`SYN-${i+1}`;
  const output=generateTaskWorkbook(master,values),after=readArchive(output.bytes),baseline=readArchive(generateTaskWorkbook(master,{}).bytes),readback=[];
  const styleBlock=(bytes:Buffer)=>/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(bytes.toString())![1];
  const xfs=(bytes:Buffer)=>[...styleBlock(bytes).matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map(m=>m[0]);
  const originalStyles=xfs(before.get('xl/styles.xml')!),fittedStyles=xfs(after.get('xl/styles.xml')!);
  assert.deepEqual(fittedStyles.slice(0,originalStyles.length),originalStyles,'original styles changed');
  const fills=(bytes:Buffer)=>[.../<fills\b[^>]*>([\s\S]*?)<\/fills>/.exec(bytes.toString())![1].matchAll(/<fill>[\s\S]*?<\/fill>/g)].map(m=>m[0]);
  const originalFills=fills(before.get('xl/styles.xml')!),generatedFills=fills(after.get('xl/styles.xml')!);
  assert.deepEqual(generatedFills.slice(0,originalFills.length),originalFills,'original fills changed');
  assert.deepEqual(generatedFills.slice(originalFills.length),CONTROL_HIGHLIGHTS.map(c=>`<fill><patternFill patternType="solid"><fgColor rgb="${c.argb}"/><bgColor indexed="64"/></patternFill></fill>`));
  const dxfs=(bytes:Buffer)=>[.../<dxfs\b[^>]*>([\s\S]*?)<\/dxfs>/.exec(bytes.toString())![1].matchAll(/<dxf\b[^>]*>[\s\S]*?<\/dxf>/g)].map(m=>m[0]);
  const originalDxfs=dxfs(before.get('xl/styles.xml')!),generatedDxfs=dxfs(after.get('xl/styles.xml')!);
  assert.deepEqual(generatedDxfs.slice(0,originalDxfs.length),originalDxfs,'original conditional formats changed');
  assert.deepEqual(generatedDxfs.slice(originalDxfs.length),['<dxf><font><color rgb="FFFF0000"/></font></dxf>'],'only Owner red font conditional format may be appended');
  const stripStyles=(bytes:Buffer)=>bytes.toString().replace(/<cellXfs\b[^>]*>[\s\S]*?<\/cellXfs>/,'').replace(/<fills\b[^>]*>[\s\S]*?<\/fills>/,'').replace(/<dxfs\b[^>]*>[\s\S]*?<\/dxfs>/,'');
  assert.equal(stripStyles(before.get('xl/styles.xml')!),stripStyles(after.get('xl/styles.xml')!),'fonts/other style definitions changed');
  const normalizeStyle=(s:string)=>s.replace(/\s+(?:applyAlignment|shrinkToFit)="[^"]*"/g,'').replace(/<alignment\s*\/>/g,'').replace(/^<xf([^>]*?)\/>$/,'<xf$1></xf>');
  for(const [name,bytes] of before)if(!output.changedParts.includes(name))assert.ok(after.get(name)!.equals(bytes),`immutable part ${name}`);
  for(const [index,sheet] of SHEETS.entries()) {
    const name=`xl/worksheets/sheet${index+1}.xml`,original=before.get(name)!.toString(),generated=after.get(name)!.toString();
    const originals=cellMap(original),derived=cellMap(generated),defs=matrix.bindings.filter(b=>b.sheet===sheet);
    const baselineCells=cellMap(baseline.get(name)!.toString());
    const control=CONTROL_HIGHLIGHTS.find(c=>c.sheet===index+1);
    const isControl=(ref:string)=>!!control&&control.columns.split('').some(col=>ref===col+control.row);
    const baseStyle=(style:string,ref:string)=>normalizeStyle(isControl(ref)?style.replace(/\s+applyFill="[^"]*"/g,'').replace(/\bfillId="\d+"/,'fillId="0"'):style);
    const merges=[...original.matchAll(/<mergeCell ref="([^"]+)"/g)].map(m=>m[1]);
    for(const b of defs) {
      const source=matrix.cells.find(c=>c.sheet===sheet&&c.cell===b.cell)!;
      assert.equal(source.formula,null,`protected formula ${b.key}`);
      for(const merge of merges)if(contains(merge,b.cell))assert.equal(merge.split(':')[0],b.cell,`merged subordinate ${b.key}`);
      const cell=derived.get(b.cell)!;
      const originalAttrs=originals.get(b.cell)!.attributes,stripAttrs=(s:string)=>s.replace(/\s+[ts]="[^"]*"/g,'');
      assert.equal(stripAttrs(cell.attributes),stripAttrs(originalAttrs),`cell attributes ${b.key}`);
      const originalStyle=Number(/\bs="(\d+)"/.exec(originalAttrs)?.[1]??0),fittedStyle=Number(/\bs="(\d+)"/.exec(cell.attributes)?.[1]??0);
      if(b.dataType==='text'&&!b.rendering){assert.match(fittedStyles[fittedStyle],/shrinkToFit="1"/);assert.equal(baseStyle(fittedStyles[fittedStyle],b.cell),baseStyle(originalStyles[originalStyle],b.cell),`base style ${b.key}`);}
      else if(isControl(b.cell))assert.equal(baseStyle(fittedStyles[fittedStyle],b.cell),baseStyle(originalStyles[originalStyle],b.cell),`control base style ${b.key}`);
      else assert.equal(fittedStyle,originalStyle,`non-text style ${b.key}`);
      if(b.dataType==='number'&&!b.rendering)assert.equal(Number(/<v>([^<]+)<\/v>/.exec(cell.body)![1]),values[b.key]);
      else if(b.dataType==='checkbox')assert.equal(texts(cell.body),b.rendering==='parentheses'?source.text.replace('(  )','( ✓ )'):source.text.replace('☐','☑'),b.key);
      else if(b.rendering==='filename')assert.equal(texts(cell.body),source.text.replace('..เติมชื่อไฟล์........',String(values[b.key])),b.key);
      else if(b.rendering==='append') {
        const expected=/…\.{2,}/.test(source.text)?source.text.replace(/…\.{2,}/,String(values[b.key])):source.text+String(values[b.key]);
        assert.equal(texts(cell.body),expected,b.key);
      } else assert.equal(texts(cell.body),values[b.key],b.key);
      // Independently populate each declared field: no cross-field or style/layout mutation.
      const individualParts=readArchive(generateTaskWorkbook(master,{[b.key]:values[b.key]}).bytes),individual=individualParts.get(name)!.toString();
      const individualCells=cellMap(individual);
      const individualStyles=xfs(individualParts.get('xl/styles.xml')!);
      for(const [ref,c] of baselineCells)if(ref!==b.cell){const actual=individualCells.get(ref)!.xml;
        if(isControl(ref)){const originalCell=originals.get(ref)!;assert.equal(actual.replace(/\bs="\d+"/,''),withoutCache(originalCell.xml).replace(/\bs="\d+"/,''),`${b.key} changed control content ${ref}`);const style=Number(/\bs="(\d+)"/.exec(actual)![1]);assert.equal(baseStyle(individualStyles[style],ref),baseStyle(originalStyles[Number(/\bs="(\d+)"/.exec(originalCell.attributes)![1])],ref),`control style ${ref}`);}
        else assert.equal(actual,withoutCache(c.xml),`${b.key} changed ${ref}`);
      }
      const stripCells=(s:string)=>s.replace(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g,'').replace(ownerAlerts,'');
      assert.equal(stripCells(individual),stripCells(original),`worksheet layout ${b.key}`);
      readback.push({key:b.key,sheet,cell:b.cell,value:values[b.key],type:b.dataType,uniqueSentinelReadback:true,individualLocality:true,mergedAnchor:true,originalStyleAndFontPreserved:true,filledTextShrinkToFit:b.dataType==='text'&&!b.rendering});
    }
    for(const [ref,c] of originals)if(!defs.some(b=>b.cell===ref)){
      const actual=derived.get(ref)!.xml;
      if(isControl(ref)){assert.equal(actual.replace(/\bs="\d+"/,''),withoutCache(c.xml).replace(/\bs="\d+"/,''),`unbound control ${sheet}!${ref}`);assert.equal(baseStyle(fittedStyles[Number(/\bs="(\d+)"/.exec(actual)![1])],ref),baseStyle(originalStyles[Number(/\bs="(\d+)"/.exec(c.attributes)![1])],ref));}
      else assert.equal(actual,withoutCache(c.xml),`unbound ${sheet}!${ref}`);
    }
  }
  const classifiedCells=matrix.cells.map(c=>{
    const index=SHEETS.indexOf(c.sheet as typeof SHEETS[number])+1,xml=before.get(`xl/worksheets/sheet${index}.xml`)!.toString();
    const merge=[...xml.matchAll(/<mergeCell ref="([^"]+)"/g)].map(m=>m[1]).find(m=>contains(m,c.cell));
    return {...c,classification:c.binding?'editable':c.formula!==null?'calculated':merge&&merge.split(':')[0]!==c.cell?'merged-subordinate':c.text?'static-source-text':'structural-blank',mergedRange:merge??null};
  });
  // Reviewed against the actual native Master: these leaders belong to fixed protocol text, rather than writable values.
  const staticLeaders:Record<string,string>={
    'Pooling Table!C21':'Continuation of the SP100 CSV instruction. The actual filename placeholder is C20 and is bound separately.',
    'Seq Task-G50!C10':'Cyclization buffer label; its protocol quantity is the adjacent fixed 27.8 uL cell.',
    'Seq Task-G50!E24':'DNB table label with wide-bore-tip instruction; its protocol quantity is the fixed 100 uL cell below.',
  };
  const suspectedInputs=classifiedCells.filter(c=>!c.binding&&c.formula===null&&(/…|\.{4,}|\(  \)/.test(c.text))).map(c=>({sheet:c.sheet,cell:c.cell,text:c.text,classification:staticLeaders[c.sheet+'!'+c.cell]?'reviewed-static-protocol-text':'source-placeholder-requires-explicit-mapping-review',reason:staticLeaders[c.sheet+'!'+c.cell]??null}));
  assert.equal(suspectedInputs.filter(c=>!c.reason).length,0,'unclassified source placeholder');
  const media=[...before].filter(([name])=>name.includes('/media/')).map(([name,bytes])=>({name,sha256:sha256(bytes),unchanged:after.get(name)!.equals(bytes),classification:/image(?:3|5|8|10|11)\.png$/.test(name)?'immutable-raster-instrument-diagram-with-printed-position-squares':'immutable-source-logo-or-instrument-diagram'}));
  return {bytes:output.bytes,evidence:{masterSha256:sha256(master),bindingCount:matrix.bindings.length,formulaCount:matrix.formulaCount,sheetCounts:SHEETS.map(sheet=>({sheet,bindings:matrix.bindings.filter(b=>b.sheet===sheet).length,formulas:matrix.cells.filter(c=>c.sheet===sheet&&c.formula!==null).length})),readback,classifiedCells,suspectedInputs,media,untouchedArchivePartsPreserved:true,allDeclaredBindingsIndividuallyVerified:true,visualFidelity:'STRUCTURAL_PRESERVATION_VERIFIED; NATIVE_AND_OWNER_VISUAL_ACCEPTANCE_SEPARATE'}};
}

async function main() {
  const source=process.env.NIPT_TASK_MASTER_PATH??'.local/lab-owner-evidence/lab-combined-master.xlsx';
  const master=await readFile(source),result=verifyBindingFidelity(master),directory=path.resolve('.local/workbook-binding-fidelity');
  await mkdir(directory,{recursive:true});
  await writeFile(path.join(directory,'unique-sentinels.xlsx'),result.bytes);
  await writeFile(path.join(directory,'binding-evidence.json'),JSON.stringify(result.evidence,null,2));
  if(process.argv.includes('--native')) {
    for(const [label,bytes] of [['master',master],['filled',result.bytes]] as const) {
      const pdfs=await exportTaskPdfs(bytes),metadata=[];
      for(const [i,{bytes:pdf,...meta}] of pdfs.entries()){await writeFile(path.join(directory,`${label}-sheet-${i+1}.pdf`),pdf);metadata.push(meta);}
      await writeFile(path.join(directory,`${label}-native-evidence.json`),JSON.stringify(metadata,null,2));
    }
  }
  assert.equal(sha256(await readFile(source)),MASTER_SHA256,'source changed during verification');
  process.stdout.write(JSON.stringify({masterSha256:result.evidence.masterSha256,bindings:result.evidence.bindingCount,formulas:result.evidence.formulaCount,individuallyVerified:result.evidence.readback.length,suspectedInputs:result.evidence.suspectedInputs,output:directory})+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
