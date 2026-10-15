/** Exact local candidate checks. Never pushes, merges, deploys or packages. */
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
const git=(args:string[])=>execFileSync('git',args,{encoding:'utf8'}).trim();
if(git(['status','--porcelain']))throw Error('CLEAN_CANDIDATE_REQUIRED');
const head=git(['rev-parse','HEAD']),branch=git(['branch','--show-current']),root=await fs.mkdtemp(path.resolve('.local/final-candidate-'+head.slice(0,7)+'-'));
const migrationHash=createHash('sha256');for(const name of (await fs.readdir('db/migrations')).filter(n=>n.endsWith('.sql')).sort())migrationHash.update(name+'\0').update(await fs.readFile('db/migrations/'+name));
const migrationsSha256=migrationHash.digest('hex'),sourceTree=git(['rev-parse','HEAD^{tree}']),master=process.env.NIPT_TASK_MASTER_PATH;if(!master)throw Error('LOCKED_MASTER_REQUIRED');
const hash=async()=>createHash('sha256').update(await fs.readFile(master)).digest('hex');if(await hash()!=='0f94efbc240b9a38ff9be77bf0c8d92c09d82fa2fe2427b9d274cc739e5607a6')throw Error('LOCKED_MASTER_MISMATCH');
const results:{name:string;head:string;sourceTree:string;migrationsSha256:string;command:string;runtimeMode:string;timestamp:string;finishedAt:string;exitCode:number;log:string}[]=[];
async function run(name:string,args:string[],mode:string,extra:Partial<NodeJS.ProcessEnv>={}){
 if(git(['rev-parse','HEAD'])!==head||git(['status','--porcelain']))throw Error('CANDIDATE_CHANGED');
 const log=path.join(root,name+'.log'),file=await fs.open(log,'wx'),timestamp=new Date().toISOString();
 const exitCode=await new Promise<number>((resolve,reject)=>{const child=spawn(process.execPath,args,{windowsHide:true,stdio:['ignore',file.fd,file.fd],env:{...process.env,NIPT_MODE:mode,NIPT_SOURCE_SHA:head,...extra}});child.once('error',reject);child.once('exit',code=>resolve(code??1));});await file.close();
 const record={name,head,sourceTree,migrationsSha256,command:'node '+args.join(' '),runtimeMode:mode,nodeVersion:process.version,platform:process.platform,flags:Object.fromEntries(['NIPT_TEST_NATIVE_EXCEL','NIPT_OPERATIONAL_TEST_BUILT_WEB'].filter(k=>extra[k]!==undefined).map(k=>[k,extra[k]])),timestamp,finishedAt:new Date().toISOString(),exitCode,log};results.push(record);await fs.writeFile(path.join(root,name+'.json'),JSON.stringify(record,null,2));process.stdout.write(name+': '+(exitCode===0?'PASS':'FAIL')+'\n');return exitCode;
}
for(const [name,args] of [['typecheck',['node_modules/next/dist/bin/next','typegen']],['tsc',['node_modules/typescript/bin/tsc','--noEmit']],['lint',['node_modules/eslint/bin/eslint.js','.','--max-warnings','0']],['guard',['--import','tsx','tools/source-guard.ts']],['build',['node_modules/next/dist/bin/next','build']]] as [string,string[]][]){if(await run(name,args,'synthetic'))throw Error('FINAL_'+name.toUpperCase()+'_FAILED');}
await Promise.all([
 run('full-regression',['node_modules/vitest/vitest.mjs','run','--reporter=default','--reporter=json','--outputFile='+path.join(root,'regression.json')],'synthetic',{NIPT_TEST_NATIVE_EXCEL:'yes'}),
 run('deployment-contracts',['--test','tests/deploy/p8-deployment.node.mjs','tests/deploy/deployment-order.node.mjs'],'synthetic'),
 run('positive-anc-s2-recovery',['--import','tsx','tools/operational/verify-positive-journey.ts','--anc','--recovery'],'operational',{NIPT_OPERATIONAL_TEST_BUILT_WEB:'yes'}),
 run('label-render-parity',['--import','tsx','tools/operational/verify-label-print.ts'],'synthetic')
]);
await run('control-highlight-native',['--import','tsx','tools/operational/verify-control-highlights.ts'],'synthetic');
// Keep native PostgreSQL verification separate from the concurrent browser/Excel and full-suite workload.
await run('native-upgrade-recovery',['--import','tsx','tools/operational/verify-native-recovery.ts'],'synthetic');
if(await hash()!=='0f94efbc240b9a38ff9be77bf0c8d92c09d82fa2fe2427b9d274cc739e5607a6')throw Error('MASTER_CHANGED');
const comparison=execFileSync('git',['merge-tree','--trivial-merge',git(['merge-base','HEAD','origin/main']),'HEAD','origin/main'],{encoding:'utf8'});await fs.writeFile(path.join(root,'integration-tree-comparison.txt'),comparison);let currentPath='';const conflicts=new Set<string>();for(const line of comparison.split('\n')){const m=/^  (?:base|our|their)\s+\d+\s+[a-f0-9]+\s+(.+)$/.exec(line);if(m)currentPath=m[1];if(line.startsWith('+<<<<<<<'))conflicts.add(currentPath);}const integrationConflicts=[...conflicts];
const main=git(['rev-parse','origin/main']),mainIntegrated=git(['merge-base',head,main])===main,parents=git(['rev-list','--parents','-n','1','HEAD']).split(' ').slice(1);
const passed=results.every(r=>r.exitCode===0),prReady=passed&&mainIntegrated&&integrationConflicts.length===0,report={head,branch,parents,mainIntegrated,prReady,sourceTree,migrationsSha256,environment:'WINDOWS_LOOPBACK_DISPOSABLE_DATABASES_NATIVE_EXCEL_CHROMIUM',masterSha256:await hash(),results,passed,mergeReady:false,integrationConflicts,main,externalTests:['Hospital LAN/UNC/SMB and deployed service ACL','HIS acknowledgement and HALOS hardware','Physical 50x20mm printer calibration','Owner golden visual acceptance','Clinical acceptance','Windows installer NOT STARTED'],timestamp:new Date().toISOString()};
await fs.writeFile(path.join(root,'readiness.json'),JSON.stringify(report,null,2));await fs.writeFile('.local/final-candidate-latest.json',JSON.stringify({directory:root,head,passed},null,2));await fs.writeFile(path.join(root,'readiness.md'),`# Final local candidate\n\n${prReady?'READY FOR PR — Awaiting Owner Approval':passed?'LOCAL SOFTWARE PASS — INTEGRATION NOT VERIFIED':'NOT READY'}\n\nHEAD: ${head}\nBranch: ${branch}\nSource tree: ${sourceTree}\nMigration SHA-256: ${migrationsSha256}\nMaster SHA-256: ${report.masterSha256}\n\n`+results.map(r=>`- ${r.exitCode===0?'PASS':'FAIL'} ${r.name}: ${r.log}`).join('\n')+'\n\n'+(prReady?'Local integration conflicts are resolved and this exact integration HEAD passed local verification. Remote PR CI and Owner approval remain pending.':'Merge readiness: NOT READY FOR MERGE until conflicts are reconciled and the exact integrated HEAD is tested.')+'\nConflicting paths: '+(integrationConflicts.join(', ')||'none')+'\n\nExternal tests: '+report.externalTests.join('; ')+'\nNo push, merge, deployment or packaging performed. Remote PR commit CI remains NOT VERIFIED. No Main merge is authorized by local verification.\n');
process.stdout.write(root+'\n');if(!passed)process.exitCode=1;
