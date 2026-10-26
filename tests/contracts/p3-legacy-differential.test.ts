import {it,expect} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parsePet} from '../../packages/integrations/pet';
import {buildSyntheticPet,classifyPet} from '../../packages/inbound/wire';
const run=promisify(execFile);
const iso=(v:string)=>v.slice(0,19);
// AT-HISIN-02 (D-04): opt-in, dev only. Point NIPT_LEGACY_PET_PARSER_DIR at an extracted copy of the legacy
// `source/app/services` folder outside the repository. Synthetic files only.
it.skipIf(!process.env.NIPT_LEGACY_PET_PARSER_DIR)('AT-HISIN-02 differential: TS parser equals legacy Python parse_pet_file on 100 synthetic files',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'nipt-p3-diff-'));
 try{
  const names=['SYNTHETIC^^นาง จำลอง','SYNTHETIC-สกุล^^น.ส. ทดสอบ หนึ่ง','SYNTHETIC^^ด.ญ. ทดลอง','SYNTHETICไทย^^นาง ก'];
  const files=Array.from({length:100},(_,i)=>buildSyntheticPet({ln:(i%7===0?'0':'')+`99000${String(3000+i).padStart(7,'0')}`,hn:i%2?`SYNTHETIC-HN-${i}`:`99000${String(i).padStart(5,'0')}`,name:names[i%names.length],dob:`19${70+(i%30)}${String(1+(i%12)).padStart(2,'0')}${String(1+(i%28)).padStart(2,'0')}`,sex:i%5?'F':'M',receivedAt:`2026101${i%10}${String(i%24).padStart(2,'0')}${String(i%60).padStart(2,'0')}05`,specimenAt:'20261010070000',orderAt:'20261009160000',ward:`SYNTHETIC-W${i%9}`,identity:`SYNTHETIC-ID-${i}`,testCode:i===99?'11111':undefined}));
  const paths:string[]=[];for(const f of files){const p=path.join(dir,f.filename);await writeFile(p,f.bytes);paths.push(p);}
  const {stdout}=await run(process.env.NIPT_PYTHON??'python',['-I','tools/his-simulator/legacy-differential.py',process.env.NIPT_LEGACY_PET_PARSER_DIR!,...paths],{maxBuffer:4_000_000,encoding:'buffer'});
  const legacy=JSON.parse(stdout.toString('utf8')) as (Record<string,string>|null)[];
  expect(legacy).toHaveLength(100);
  for(const [i,f] of files.entries()){
   if(i===99){expect(legacy[i]).toBeNull();expect(classifyPet(f.bytes)).toBe('NOT_NIPT');continue;}
   const ts=parsePet(f.bytes,f.filename),py=legacy[i]!;
   // Owner PET clock lock (commit b91e26e): NIPT-CBH's receivedAt is the ACTUAL HIS receipt time (P[23]); the legacy parser's `request_date`
   // is a different field, so that one field intentionally differs and is checked as a valid timestamp instead of equal to legacy.
   expect(Number.isNaN(Date.parse(ts.receivedAt)),f.filename).toBe(false);
   const [last,rest]=ts.name.split('^^'),[prefix,...first]=rest.split(' ');
   expect({ln:py.ln,hn:py.hn,dob:py.dob,sex:py.sex,specimen:py.specimen_date,order:py.order_date,ward:py.ward_code,id:py.citizen_id,code:py.test_code,section:py.section,last:py.name_last,prefix:py.name_prefix,first:py.name_first},f.filename)
    .toEqual({ln:ts.ln,hn:ts.hn,dob:ts.dob.slice(0,10),sex:ts.sex,specimen:iso(ts.specimenAt),order:iso(ts.orderAt),ward:ts.ward,id:ts.identity,code:'70096',section:'7',last,prefix,first:first.join(' ')});
  }
 }finally{await rm(dir,{recursive:true,force:true});}
},60000);
