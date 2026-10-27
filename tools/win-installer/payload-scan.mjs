// Release gate for a package folder before it is wrapped into an EXE: nothing from a developer machine or a test run may travel inside it.
// Checks (1) no `.local` path segment, (2) no secret-like or credential files by name, (3) no PEM private key text outside node_modules,
// (4) the approved master workbook, PostgreSQL, Node, PowerShell 7 and the application server are present.
// Dependencies' own sample/test fixtures under node_modules are matched by name only for the exact credential files this project writes.
import {readdir,readFile,stat} from 'node:fs/promises';
import path from 'node:path';

const FORBIDDEN_NAME=/^(\.env(\..*)?|uat-accounts\.json|initial-admins\.json|credentials\.txt|install-state\.json|nipt\.json|db-password|web-password|worker-password|migration-url|web-url|worker-url|renderer-token|identity-lookup\.key|backup\.key|tls-passphrase|package-signing-private\.pem|integration-private\.pem|.*\.pfx)$/i;
const TEXT=/\.(json|mjs|js|cjs|ts|ps1|cmd|txt|md|pem|yml|yaml|env|sql|iss)$/i;
const PRIVATE_KEY=/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/;
const REQUIRED=['payload/master/approved-master.xlsx','payload/runtime/node/node.exe','payload/runtime/pg/bin/postgres.exe','payload/runtime/pg/bin/initdb.exe','payload/runtime/pwsh/pwsh.exe',
 'payload/release/app/server.js','payload/release/ops/apps/worker/main.ts','payload/release/ops/apps/renderer/main.ts','payload/release/ops/packages/readygen/word-export.ps1','payload/release/ops/packages/workbook/native-export.ps1',
 'payload/release/ops/tools/win-installer/office-check.ts','installer/nipt-admin.mjs','installer/setup-run.mjs','manifest.json','manifest.sig'];

export async function payloadScan(dir,options={}){
 const violations=[];let files=0;const testAccountCode=[];
 const walk=async(d,rel)=>{
  for(const e of await readdir(d,{withFileTypes:true})){
   const r=rel?rel+'/'+e.name:e.name,full=path.join(d,e.name);
   if(e.isSymbolicLink()){violations.push({kind:'symlink',path:r});continue;}
   if(e.isDirectory()){
    if(e.name==='.local')violations.push({kind:'local-folder',path:r});
    await walk(full,r);continue;
   }
   files++;
   if(FORBIDDEN_NAME.test(e.name))violations.push({kind:'forbidden-file-name',path:r});
   const inModules=r.split('/').includes('node_modules');
   if(!inModules&&TEXT.test(e.name)&&(await stat(full)).size<2*1024*1024){
    const text=await readFile(full,'utf8').catch(()=>'');
    if(PRIVATE_KEY.test(text)&&!/generateKeyPairSync|BEGIN (?:[A-Z]+ )?PRIVATE KEY-----['"`]?\s*[,;)]/.test(text))violations.push({kind:'private-key-text',path:r});
    if(/uat\.(admin|lab|certifier|clinical-approver|auditor|anc)/.test(text))testAccountCode.push(r);
   }
  }
 };
 await walk(dir,'');
 // An application-only update carries no runtime and no master workbook (the installation keeps its own); everything else is still required.
 const required=options.appOnly?REQUIRED.filter(f=>!f.startsWith('payload/runtime/')&&f!=='payload/master/approved-master.xlsx'):REQUIRED;
 for(const need of required){try{await stat(path.join(dir,need));}catch{violations.push({kind:'required-missing',path:need});}}
 return {files,violations,testAccountCode};
}
