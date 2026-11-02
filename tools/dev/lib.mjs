// Shared plumbing of the fast development loop (tools/dev/*) and the release preflight (tools/release/*).
// Node built-ins only. Every step is run WITHOUT a shell, with its full output kept in a log file and a structured result returned, so a failure
// names the stage, the command, the exit code, the relevant output, the duration, the commit and the environment, and says whether a retry is safe.
import {spawn,execFileSync} from 'node:child_process';
import {createWriteStream,mkdirSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

export const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..');
export const STATUS={PASS:'PASS',FAIL:'FAIL',BLOCKED:'BLOCKED',SKIPPED:'SKIPPED'};
const TAIL_LINES=40;

export const toolScript=(...parts)=>path.join(repoRoot,'node_modules',...parts);
export const TOOLS={
 tsc:toolScript('typescript','bin','tsc'),
 eslint:toolScript('eslint','bin','eslint.js'),
 vitest:toolScript('vitest','vitest.mjs'),
 next:toolScript('next','dist','bin','next'),
};

export function git(args,{cwd=repoRoot,allowFail=false}={}){
 try{return execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).replace(/\r?\n$/,'');}
 catch(e){if(allowFail)return null;throw Error('GIT_FAILED: git '+args.join(' ')+': '+String(e.stderr||e.message).trim());}
}
export function sourceIdentity(cwd=repoRoot){
 const commit=git(['rev-parse','HEAD'],{cwd,allowFail:true})??'unknown';
 const branch=git(['rev-parse','--abbrev-ref','HEAD'],{cwd,allowFail:true})??'unknown';
 const dirty=(git(['status','--porcelain','--untracked-files=normal'],{cwd,allowFail:true})??'').split('\n').filter(Boolean).length;
 return {commit,branch,dirtyFiles:dirty};
}

/** Files that differ from `base` (default: HEAD, i.e. the uncommitted work) plus untracked files, as repository-relative POSIX paths. */
export function changedFiles({base='HEAD',cwd=repoRoot}={}){
 const set=new Set();
 const add=text=>{for(const f of String(text??'').split('\n'))if(f.trim())set.add(f.trim().replaceAll('\\','/'));};
 add(git(['diff','--name-only','--no-renames',base,'--'],{cwd}));
 if(base!=='HEAD')add(git(['diff','--name-only','--no-renames','HEAD','--'],{cwd}));
 add(git(['ls-files','--others','--exclude-standard'],{cwd}));
 return [...set].sort();
}

export function newRunId(prefix){return prefix+'-'+new Date().toISOString().replace(/[-:]/g,'').replace(/\..*/,'Z');}
export function runDirectory(kind,runId){
 const dir=path.join(repoRoot,'.local',kind==='release'?'release':'dev','runs',runId);
 mkdirSync(dir,{recursive:true});return dir;
}

const tail=text=>String(text).split(/\r?\n/).filter((l,i,a)=>l.length||i<a.length-1).slice(-TAIL_LINES).join('\n');

/**
 * Runs one step. `hint` says what to do next and `retrySafe` whether running it again can do harm (every step of the development loop is read-only
 * or touches only .local/ and is retry-safe; a step that would change shared state must say so).
 * Returns {id,title,status,exitCode,durationMs,command,logFile,output,hint,retrySafe,...}. Never throws for a failing command.
 */
export async function runStep({id,title,command,args=[],cwd=repoRoot,env={},timeoutMs=20*60_000,hint='',retrySafe=true,logDir,treatAsBlocked=null}){
 const started=Date.now();
 const shown=[path.basename(command)==='node.exe'||command===process.execPath?'node':command,...args.map(a=>String(a).replace(repoRoot,'.'))].join(' ');
 const logFile=logDir?path.join(logDir,id.replace(/[^a-z0-9._-]+/gi,'_')+'.log'):null;
 if(logFile)mkdirSync(path.dirname(logFile),{recursive:true});
 const out=logFile?createWriteStream(logFile):null;
 let buffer='',timedOut=false;
 const result=await new Promise(resolve=>{
  let child;
  try{child=spawn(command,args,{cwd,env:{...process.env,...env},windowsHide:true,stdio:['ignore','pipe','pipe']});}
  catch(e){resolve({exitCode:127,error:e.message});return;}
  const sink=d=>{const s=d.toString();buffer=(buffer+s).slice(-64_000);out?.write(s);};
  child.stdout.on('data',sink);child.stderr.on('data',sink);
  const timer=setTimeout(()=>{timedOut=true;child.kill();},timeoutMs);
  child.on('error',e=>{clearTimeout(timer);resolve({exitCode:127,error:e.message});});
  child.on('close',code=>{clearTimeout(timer);resolve({exitCode:code??1});});
 });
 out?.end();
 const durationMs=Date.now()-started;
 let status=result.exitCode===0?STATUS.PASS:STATUS.FAIL;
 if(status===STATUS.FAIL&&treatAsBlocked&&treatAsBlocked(buffer,result.exitCode))status=STATUS.BLOCKED;
 return {id,title,status,exitCode:result.exitCode,durationMs,command:shown,cwd:path.relative(repoRoot,cwd)||'.',logFile:logFile?path.relative(repoRoot,logFile):null,
  output:status===STATUS.PASS?'':tail(result.error?result.error+'\n'+buffer:buffer),timedOut,hint:status===STATUS.PASS?'':hint,retrySafe};
}

export const skipped=(id,title,reason)=>({id,title,status:STATUS.SKIPPED,exitCode:null,durationMs:0,reason});
export const blocked=(id,title,reason,hint='')=>({id,title,status:STATUS.BLOCKED,exitCode:null,durationMs:0,reason,hint,retrySafe:true});
export const passed=(id,title,durationMs=0,detail={})=>({id,title,status:STATUS.PASS,exitCode:0,durationMs,...detail});
export const failed=(id,title,reason,hint='',extra={})=>({id,title,status:STATUS.FAIL,exitCode:1,durationMs:0,reason,hint,retrySafe:true,...extra});

export const seconds=ms=>(ms/1000).toFixed(ms<10_000?1:0)+'s';

/** Overall verdict: any FAIL → FAIL; else any BLOCKED → BLOCKED (never reported as PASS); else PASS. Exit codes: 0 / 1 / 2. */
export function verdict(results){
 if(results.some(r=>r.status===STATUS.FAIL))return {status:STATUS.FAIL,exitCode:1};
 if(results.some(r=>r.status===STATUS.BLOCKED))return {status:STATUS.BLOCKED,exitCode:2};
 return {status:STATUS.PASS,exitCode:0};
}

const ICON={PASS:'PASS   ',FAIL:'FAIL   ',BLOCKED:'BLOCKED',SKIPPED:'skip   '};
export function renderSummary({title,results,identity,environment,totalMs,reportFile}){
 const lines=[`\n${title}`,`  commit ${identity.commit.slice(0,12)} (${identity.branch}${identity.dirtyFiles?`, ${identity.dirtyFiles} uncommitted file(s)`:''})  environment ${environment}`,''];
 for(const r of results){
  lines.push(`  ${ICON[r.status]} ${r.title.padEnd(46)} ${r.status===STATUS.SKIPPED?(r.reason??''):seconds(r.durationMs)}`);
  if(r.status===STATUS.FAIL||r.status===STATUS.BLOCKED){
   if(r.reason)lines.push(`          reason  : ${r.reason}`);
   if(r.command)lines.push(`          command : ${r.command}   (exit ${r.exitCode}${r.timedOut?', timed out':''})`);
   if(r.output)lines.push(...r.output.split('\n').slice(-18).map(l=>'          | '+l));
   if(r.logFile)lines.push(`          full log: ${r.logFile}`);
   if(r.hint)lines.push(`          next    : ${r.hint}`);
   lines.push(`          retry   : ${r.retrySafe===false?'NOT safe to repeat blindly':'safe to repeat'}`);
  }
 }
 const v=verdict(results);
 lines.push('',`  RESULT ${v.status}  in ${seconds(totalMs)}${reportFile?`   report: ${reportFile}`:''}`);
 return lines.join('\n');
}

export function writeReport(dir,name,data){
 const file=path.join(dir,name);writeFileSync(file,JSON.stringify(data,null,2));
 const latest=path.join(dir,'..','..',name.replace(/\.json$/,'')+'-latest.json');
 try{writeFileSync(latest,JSON.stringify(data,null,2));}catch{/* the run folder copy is the record */}
 return path.relative(repoRoot,file);
}

export function machineFacts(){
 return {platform:process.platform,node:process.version,cpus:os.cpus().length,totalMemGb:Math.round(os.totalmem()/2**30*10)/10,freeMemGb:Math.round(os.freemem()/2**30*10)/10};
}
export function readJson(file){return JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''));}
export const exists=existsSync;
