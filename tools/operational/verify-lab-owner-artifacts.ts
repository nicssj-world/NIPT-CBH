import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {generateTaskWorkbook,MASTER_SHA256} from '../../packages/workbook/master';
import {calculateOwnerPooling,exportOwnerPoolingCsv,type PhysicalQc} from '../../packages/pooling/owner-master';
import {sha256} from '../../packages/workbook/archive';
const root=path.resolve('.local/lab-owner-evidence');
await mkdir(root,{recursive:true});
if(process.argv.includes('--check-native')){
 const checks=[];
 for(const name of ['default47','urgent48','boundary40']){
  const expected=JSON.parse(await readFile(path.join(root,name+'-expected.json'),'utf8')) as ReturnType<typeof calculateOwnerPooling>;
  const native=JSON.parse(await readFile(path.join(root,name+'-native.json'),'utf8')) as {rows:{slot:number;volume:number|null|string}[];dates:{captionColor:number;captionBold:boolean;valueColor:number;valueBold:boolean;value:string}[];v1:number;eb:number;total:number;desired:number;buffer:number};
  for(const row of expected.rows){const actual=native.rows.find(r=>r.slot===row.slot)!;if(row.volume===null)assert.ok(actual.volume===null||actual.volume==='');else assert.ok(Math.abs(Number(row.volume)-Number(actual.volume))<1e-10,`${name} slot ${row.slot}`);}
  assert.equal(native.v1,50);assert.equal(native.eb,50);assert.ok(Math.abs(native.total-Number(expected.total))<1e-10);assert.equal(native.desired,768);
  for(const date of native.dates){assert.equal(date.captionColor,0);assert.equal(date.valueColor,0);assert.equal(date.captionBold,true);assert.equal(date.valueBold,true);assert.equal(date.value,'22/10/2569');}
  checks.push({name,engine:'Microsoft Excel',slots:48,volumeParity:'PASS',dateBlackBold:'PASS',dilution:'PASS'});
 }
 await writeFile(path.join(root,'native-comparison.json'),JSON.stringify(checks,null,2));console.log(JSON.stringify(checks));
}else{
 const master=await readFile(path.join(root,'lab-combined-master.xlsx')),csv=await readFile('C:/Users/User/Downloads/Pooling Sheet Template_R001.csv');assert.equal(sha256(master),MASTER_SHA256);
 for(const name of ['default47','urgent48','boundary40']){
  const rows:PhysicalQc[]=Array.from({length:48},(_,i)=>({slot:i+1,sampleId:i===0?'26N120261022-1':i===24?'26N220261022-1':i===39&&name!=='urgent48'?'26N320261022-1':`26B261022${String(i+1).padStart(3,'0')}-1`,kind:i===0?'PC':i===24?'NC':i===39&&name!=='urgent48'?'BLANK':'PATIENT',concentration:i===39&&name!=='urgent48'?null:i===1?'30':'20'}));
  if(name==='boundary40'){for(let i=2;i<=8;i++){rows[i].kind='EMPTY';rows[i].sampleId='';rows[i].concentration=null;}rows[0].concentration='32';}
  const values:Record<string,unknown>={'pool.dilutionC1':6.66,'pool.concentration':3.3,'seq.date':'22/10/2569','seq.operator':'SYNTHETIC LAB TEST','qc.date':'22/10/2569','qc.operator':'SYNTHETIC LAB TEST'};
  for(let sheet=1;sheet<=3;sheet++){values[`task.${sheet}.date`]='22/10/2569';values[`task.${sheet}.run`]='Run001/2026';values[`task.${sheet}.operator`]='SYNTHETIC LAB TEST';for(const [key,v]of [['standard1',0],['standard2',100],['standard2Concentration',10]] as const)values[`qc.${sheet}.${key}`]=v;}
  for(const row of rows){values[`slot.${row.slot}.printedSampleId`]=row.sampleId;if(row.concentration!==null)values[`slot.${row.slot}.libraryQc`]=Number(row.concentration);}
  const calculation=calculateOwnerPooling(master,rows),workbook=generateTaskWorkbook(master,values),poolCsv=exportOwnerPoolingCsv(csv,calculation);
  await writeFile(path.join(root,name+'.xlsx'),workbook.bytes);await writeFile(path.join(root,name+'.csv'),poolCsv);await writeFile(path.join(root,name+'-expected.json'),JSON.stringify(calculation,null,2));
  console.log(JSON.stringify({name,masterSha256:MASTER_SHA256,xlsxSha256:workbook.sha256,csvSha256:sha256(poolCsv),measured:calculation.measuredCount}));
 }
}
