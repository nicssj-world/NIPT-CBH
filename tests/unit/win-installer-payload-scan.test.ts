import {describe,expect,it,afterAll} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {payloadScan} from '../../tools/win-installer/payload-scan.mjs';

const dirs:string[]=[];
afterAll(async()=>{for(const d of dirs)await rm(d,{recursive:true,force:true});});
const REQUIRED=['payload/master/approved-master.xlsx','payload/runtime/node/node.exe','payload/runtime/pg/bin/postgres.exe','payload/runtime/pg/bin/initdb.exe','payload/runtime/pwsh/pwsh.exe',
 'payload/release/app/server.js','payload/release/ops/apps/worker/main.ts','payload/release/ops/apps/renderer/main.ts','payload/release/ops/packages/readygen/word-export.ps1','payload/release/ops/packages/workbook/native-export.ps1',
 'payload/release/ops/tools/win-installer/office-check.ts','installer/nipt-admin.mjs','installer/setup-run.mjs','manifest.json','manifest.sig'];
async function makePackage(extra:Record<string,string>={}){
 const dir=await mkdtemp(path.join(tmpdir(),'payload-scan-'));dirs.push(dir);
 for(const f of [...REQUIRED])await mkdir(path.dirname(path.join(dir,f)),{recursive:true}).then(()=>writeFile(path.join(dir,f),'x'));
 for(const [f,c] of Object.entries(extra)){await mkdir(path.dirname(path.join(dir,f)),{recursive:true});await writeFile(path.join(dir,f),c);}
 return dir;
}

describe('production payload scan',()=>{
 it('accepts a complete package with no developer or credential files',async()=>{
  const r=await payloadScan(await makePackage());
  expect(r.violations).toEqual([]);
 });
 it('refuses .local folders, credential files, private-key text and a missing required component',async()=>{
  const dir=await makePackage({'payload/release/app/.local/x.txt':'x','installer/uat-accounts.json':'[]','payload/release/ops/key.txt':'-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----','payload/release/ops/.env.local':'A=1'});
  await rm(path.join(dir,'payload','master','approved-master.xlsx'));
  const kinds=(await payloadScan(dir)).violations.map(v=>v.kind+':'+v.path).sort();
  expect(kinds).toEqual(expect.arrayContaining(['local-folder:payload/release/app/.local','forbidden-file-name:installer/uat-accounts.json','private-key-text:payload/release/ops/key.txt','forbidden-file-name:payload/release/ops/.env.local','required-missing:payload/master/approved-master.xlsx']));
 });
});
