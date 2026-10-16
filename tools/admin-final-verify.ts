/** Exact local candidate receipt; no push/merge/deploy/package operations. */
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
const git=(args:string[])=>execFileSync('git',args,{encoding:'utf8'}).trim();
if(git(['status','--porcelain']))throw Error('CLEAN_LOCAL_CANDIDATE_REQUIRED');
const head=git(['rev-parse','HEAD']),sourceTree=git(['rev-parse','HEAD^{tree}']),branch=git(['branch','--show-current']);
if(branch!=='feat/admin-settings-completion')throw Error('ADMIN_BRANCH_REQUIRED');
const baseline='ea48e624c21cb7fef89e89bc4c02241300a3dd02';
for(const row of git(['diff','--name-status',baseline,head,'--','db/migrations']).split('\n').filter(Boolean))if(!/^A\s+db\/migrations\/0(?:96|97|98)_/.test(row))throw Error('LEGACY_MIGRATION_CHANGED');
if(git(['diff',baseline,head,'--','tools/migration-checksums.ts']))throw Error('CHECKSUM_LEDGER_TOOL_CHANGED');
await fs.mkdir('.local',{recursive:true});const root=await fs.mkdtemp(path.resolve('.local/admin-final-'+head.slice(0,7)+'-'));
const hash=createHash('sha256');for(const name of (await fs.readdir('db/migrations')).filter(n=>n.endsWith('.sql')).sort())hash.update(name+'\0').update(await fs.readFile('db/migrations/'+name));const migrationsSha256=hash.digest('hex');
const env={...process.env,NIPT_MODE:'synthetic'};for(const key of ['DATABASE_URL','NIPT_OPERATIONAL_DATABASE','NIPT_TEST_DATABASE_URL','NIPT_P6_NATIVE_URL','NIPT_P7_NATIVE_URL','NIPT_E2E_AUDIT_DATABASE_URL','NIPT_TEST_NATIVE_EXCEL'])delete env[key as keyof typeof env];
const results:{name:string;head:string;sourceTree:string;startedAt:string;finishedAt:string;exitCode:number;log:string;command:string[]}[]=[];
async function run(name:string,args:string[]){if(git(['rev-parse','HEAD'])!==head||git(['status','--porcelain']))throw Error('CANDIDATE_CHANGED');const log=path.join(root,name+'.log'),file=await fs.open(log,'wx'),startedAt=new Date().toISOString();const code=await new Promise<number>((resolve,reject)=>{const c=spawn(process.execPath,args,{cwd:process.cwd(),env,windowsHide:true,stdio:['ignore',file.fd,file.fd]});c.once('error',reject);c.once('exit',code=>resolve(code??1));});await file.close();results.push({name,head,sourceTree,startedAt,finishedAt:new Date().toISOString(),exitCode:code,log,command:['node',...args]});await fs.writeFile(path.join(root,'commands.json'),JSON.stringify(results,null,2));process.stdout.write(name+': '+(code===0?'PASS':'FAIL')+'\n');return code;}
for(const [name,args] of [
 ['typegen',['node_modules/next/dist/bin/next','typegen']],['typecheck',['node_modules/typescript/bin/tsc','--noEmit']],
 ['lint',['node_modules/eslint/bin/eslint.js','.','--max-warnings','0']],['guard',['--import','tsx','tools/source-guard.ts']],
 ['diff-check',['--import','tsx','-e',"import {execFileSync} from 'node:child_process';execFileSync('git',['diff','--check','ea48e624c21cb7fef89e89bc4c02241300a3dd02','HEAD'],{stdio:'inherit'});"]],
 ['production-build',['node_modules/next/dist/bin/next','build']],
 ['full-regression',['node_modules/vitest/vitest.mjs','run','--reporter=default','--reporter=json','--outputFile='+path.join(root,'regression.json')]],
 ['deployment-contracts',['--test','tests/deploy/p8-deployment.node.mjs','tests/deploy/deployment-order.node.mjs']],
 ['admin-browser-native',['--import','tsx','tools/admin-verify-browser.ts']]
] as [string,string[]][]){if(await run(name,args))break;}
const passed=results.length===9&&results.every(x=>x.exitCode===0),workingTreeClean=!git(['status','--porcelain']);let regression:Record<string,unknown>|null=null;try{const raw=JSON.parse(await fs.readFile(path.join(root,'regression.json'),'utf8'));regression=Object.fromEntries(['numTotalTests','numPassedTests','numFailedTests','numPendingTests','numPassedTestSuites','numPendingTestSuites'].map(k=>[k,raw[k]]));}catch{}
const report={status:passed&&workingTreeClean?'ADMIN SETTINGS READY FOR INTEGRATION':'ADMIN SETTINGS NOT READY — BLOCKERS REMAIN',head,sourceTree,branch,baseline,migrationsSha256,workingTreeClean,results,regression,environment:'WINDOWS_LOCAL_DISPOSABLE_LOOPBACK_DATABASES_CHROMIUM',scope:'Local software integration candidate only',notVerified:['Hospital IT identity/enrollment operations','Hospital share/LAN/SMB and deployed service ACLs','HIS acknowledgement / physical HALOS','Clinical and Owner acceptance','Windows installer (NOT STARTED)','Remote exact-head CI (NOT RUN)'],noPushMergeDeployInstaller:true};
await fs.writeFile(path.join(root,'readiness.json'),JSON.stringify(report,null,2));await fs.writeFile('.local/admin-final-verification.json',JSON.stringify(report,null,2));await fs.writeFile('.local/admin-final-readiness.md',`# ${report.status}\n\nHEAD: ${head}\nBranch: ${branch}\nSource tree: ${sourceTree}\nMigration inventory SHA-256: ${migrationsSha256}\nWorking tree clean: ${workingTreeClean}\n\n`+results.map(r=>`- ${r.exitCode===0?'PASS':'FAIL'} ${r.name}: ${r.log}`).join('\n')+'\n\nRegression: '+JSON.stringify(regression)+'\n\nNOT VERIFIED: '+report.notVerified.join('; ')+'\nNo push, merge, deployment or installer. Owner review is required before integration.\n');process.stdout.write(JSON.stringify({status:report.status,head,artifactDirectory:root,regression})+'\n');if(!passed||!workingTreeClean)process.exitCode=1;
