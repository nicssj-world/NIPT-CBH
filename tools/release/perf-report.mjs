// npm run perf:report — where does a deployment's time go? Reads the run records the deployment scripts already keep (read only) and, when present,
// the per-phase package timing (build-package.ts --perf-out). Nothing is estimated: a stage the logs do not separate is reported as part of its enclosing step.
//   npm run perf:report                                   all runs under C:\NIPT-CBH\deploy\history (override: --history <dir> or NIPT_DEPLOY_HISTORY)
//   npm run perf:report -- --since 2026-11-02 --env production
//   npm run perf:report -- --package-perf <file.json>     add the phase breakdown of one package build
//   npm run perf:report -- --out .local/release/perf.json
import {readdirSync,readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {repoRoot} from '../dev/lib.mjs';

const args=process.argv.slice(2);
const value=n=>{const i=args.indexOf('--'+n);return i<0?undefined:args[i+1];};
const history=value('history')??process.env.NIPT_DEPLOY_HISTORY??'C:\\NIPT-CBH\\deploy\\history';
const since=value('since')?Date.parse(value('since')):0;
const envFilter=value('env');

const STAGES=[
 [/^validation: npm ci/,'dependency installation (npm ci)'],
 [/^validation: (typecheck|lint|test:unit|guard|related tests|deploy contracts)/,'typecheck / lint / tests'],
 [/^package:/,'package (build + stage + hash + sign)'],
 [/^engine: (upgrade|install)/,'engine upgrade/install (backup, migration, switch, start, health)'],
 [/^engine: (status|health|schema)/,'post-deploy verification'],
 [/^journey|^workflow/,'workflow UAT journey']
];
const stageOf=step=>(STAGES.find(([re])=>re.test(step))?.[1])??step;

export function analyseRun(dir){
 const logFile=path.join(dir,'run.log'),recordFile=path.join(dir,'record.json');
 if(!existsSync(logFile)||!existsSync(recordFile))return null;
 const record=JSON.parse(readFileSync(recordFile,'utf8').replace(/^\uFEFF/,''));
 const lines=readFileSync(logFile,'utf8').split(/\r?\n/).map(l=>/^(\S+) \[(\w+)\] (.*)$/.exec(l)).filter(Boolean).map(m=>({t:Date.parse(m[1]),level:m[2],text:m[3]}));
 if(!lines.length)return null;
 const end=Date.parse(record.finishedAt??'')||lines.at(-1).t;
 const stages={};
 const steps=lines.filter(l=>l.level==='STEP');
 const first=steps[0]?.t??end;
 stages['source, worktree and asset checks']=Math.max(0,first-lines[0].t)/1000;
 steps.forEach((s,i)=>{const stop=steps[i+1]?.t??end;const name=stageOf(s.text);stages[name]=(stages[name]??0)+(stop-s.t)/1000;});
 const total=(end-lines[0].t)/1000;
 const failedStep=record.outcome==='FAILED'?(steps.at(-1)?.text??null):null;
 return {runId:record.runId,environment:record.environment,action:record.action,outcome:record.outcome,startedAt:record.startedAt,commit:record.commit??null,releaseId:record.releaseId??null,
  totalSeconds:Math.round(total),stages:Object.fromEntries(Object.entries(stages).map(([k,v])=>[k,Math.round(v)])),failedAfterStep:failedStep,error:record.error?String(record.error).replace(/\s+/g,' ').slice(0,160):null};
}

export function collect(){
 const runs=[];
 for(const env of ['staging','production']){
  if(envFilter&&env!==envFilter)continue;
  const root=path.join(history,env);if(!existsSync(root))continue;
  for(const d of readdirSync(root,{withFileTypes:true}).filter(e=>e.isDirectory()&&/-deploy$/.test(e.name))){
   const r=analyseRun(path.join(root,d.name));if(r&&(!since||Date.parse(r.startedAt)>=since))runs.push(r);
  }
 }
 return runs.sort((a,b)=>a.startedAt.localeCompare(b.startedAt));
}
const median=a=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y);return s[Math.floor(s.length/2)];};

export function summarise(runs){
 const byOutcome={SUCCEEDED:runs.filter(r=>r.outcome==='SUCCEEDED'),FAILED:runs.filter(r=>r.outcome==='FAILED')};
 const stageNames=[...new Set(runs.flatMap(r=>Object.keys(r.stages)))];
 const perStage=Object.fromEntries(stageNames.map(n=>{const v=runs.filter(r=>r.stages[n]!==undefined).map(r=>r.stages[n]);return [n,{runs:v.length,medianSeconds:median(v),maxSeconds:Math.max(...v)}];}));
 const failedStage={};for(const r of byOutcome.FAILED){const k=r.failedAfterStep?stageOf(r.failedAfterStep):'before the first step';failedStage[k]=(failedStage[k]??0)+1;}
 const wasted=byOutcome.FAILED.reduce((a,r)=>a+r.totalSeconds,0);
 return {runs:runs.length,succeeded:byOutcome.SUCCEEDED.length,failed:byOutcome.FAILED.length,medianTotalSecondsSucceeded:median(byOutcome.SUCCEEDED.map(r=>r.totalSeconds)),
  secondsSpentOnFailedRuns:wasted,failedByStage:failedStage,perStage};
}

const cli=process.argv[1]&&path.resolve(process.argv[1])===path.resolve(import.meta.filename);
if(cli){
 if(!existsSync(history)){process.stderr.write(`No deployment history at ${history} (BLOCKED: run on the deployment server or pass --history <dir>).\n`);process.exit(2);}
 const runs=collect();const summary=summarise(runs);
 const pkgFile=value('package-perf');const packagePerf=pkgFile&&existsSync(pkgFile)?JSON.parse(readFileSync(pkgFile,'utf8')):null;
 const report={format:'NIPT_PERF_REPORT_V1',generatedAt:new Date().toISOString(),history,filter:{since:value('since')??null,environment:envFilter??null},summary,packagePerf,runs};
 const out=value('out')??path.join(repoRoot,'.local','release','perf-report.json');
 mkdirSync(path.dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(report,null,1));
 const m=s=>s===null||s===undefined?'n/a':`${Math.floor(s/60)}m${String(s%60).padStart(2,'0')}s`;
 const L=[`Deployment performance — ${runs.length} run(s) from ${history}`,`  succeeded ${summary.succeeded}, failed ${summary.failed}; median successful run ${m(summary.medianTotalSecondsSucceeded)}; time spent in failed runs ${m(summary.secondsSpentOnFailedRuns)}`,'','  stage (median / max over runs that had it)'];
 for(const [k,v] of Object.entries(summary.perStage).sort((a,b)=>b[1].medianSeconds-a[1].medianSeconds))L.push(`    ${k.padEnd(62)} ${m(v.medianSeconds).padStart(7)} / ${m(v.maxSeconds).padStart(7)}   (${v.runs} runs)`);
 L.push('','  failed runs by the stage they died in:');
 for(const [k,v] of Object.entries(summary.failedByStage))L.push(`    ${String(v).padStart(3)} × ${k}`);
 if(packagePerf){L.push('',`  package build ${packagePerf.version} (${packagePerf.appOnly?'app only':'full'}), cache ${JSON.stringify(packagePerf.buildCache)}: total ${m(Math.round(packagePerf.totalSeconds))}`);for(const p of packagePerf.phases)L.push(`    ${p.phase.padEnd(24)} ${p.seconds}s`);}
 L.push('',`  machine-readable: ${path.relative(repoRoot,out)}`);
 process.stdout.write(L.join('\n')+'\n');
}
