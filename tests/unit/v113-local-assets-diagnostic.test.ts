import {it,expect} from 'vitest';
import {existsSync} from 'node:fs';
import {mkdir,copyFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
it('isolated v1.1.3 synthetic test assets match read-only frozen v1.1.2 originals',async()=>{
 const src=path.resolve('../claude-update-112');
 const files=['.local/lab-owner-evidence/lab-combined-master.xlsx','.local/approved/pooling.csv','.local/approved/nifty.xlsx','.local/approved/halos-task.xlsx','.local/task3-sources/singleton.docx','.local/task3-sources/twin.docx'];
 const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
 for(const rel of files){
  const from=path.join(src,rel),to=path.resolve(rel);
  expect(existsSync(from)).toBe(true);
  if(!existsSync(to)){
   await mkdir(path.dirname(to),{recursive:true});
   await copyFile(from,to);
  }
  expect(sha(await readFile(to))).toBe(sha(await readFile(from)));
 }
});
