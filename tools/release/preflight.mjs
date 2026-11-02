// npm run release:preflight — the gate between "it works in the development loop" and "build a signed package / touch Staging or Production".
// Everything here is read-only or confined to .local/ and an in-memory PostgreSQL. It does not sign, package, install or deploy anything, and it never
// connects to a real database. A FAIL stops promotion (exit 1); a prerequisite that is missing on this machine is BLOCKED (exit 2), never PASS.
//
//   npm run release:preflight                          full candidate check of HEAD against the merge-base with main (build included)
//   npm run release:preflight -- --base <ref>          compare against another revision (e.g. the installed release's commit)
//   npm run release:preflight -- --stage predeploy     only the deterministic checks that must pass before packaging (used by deploy-*.ps1)
//   npm run release:preflight -- --no-build            skip the production build (reported as SKIPPED, not PASS)
//   npm run release:preflight -- --env production      check the Production signing/definition prerequisites (read only; deploys nothing)
//   npm run release:preflight -- --full                additionally run the complete vitest suite (release qualification; long)
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {repoRoot,TOOLS,STATUS,runStep,skipped,failed,passed,git,sourceIdentity,runDirectory,newRunId,renderSummary,verdict,writeReport,machineFacts,readJson} from '../dev/lib.mjs';
import {childEnvironment} from '../dev/dev-env.mjs';
import {checkNode,checkDependencies,checkCleanRevision,checkMigrationInventory,checkAssets,checkEnvironmentIdentity,checkSigningPrerequisite,checkResources,checkWorkingTreeHasNoHospitalData} from './checks.mjs';
import {verifyBuildStamp,writeBuildStamp,restoreBuildCache,saveBuildCache,cacheKey} from './build-stamp.mjs';

const args=process.argv.slice(2);
const flag=n=>args.includes('--'+n);
const value=n=>{const i=args.indexOf('--'+n);return i<0?undefined:args[i+1];};
const stage=value('stage')??'full';
const targetEnv=value('env')??'staging';
if(!['full','predeploy'].includes(stage)||!['staging','production'].includes(targetEnv)){process.stderr.write('usage: release:preflight [--stage full|predeploy] [--env staging|production] [--base <ref>] [--no-build] [--full]\n');process.exit(1);}

const t0=Date.now();
const runId=newRunId('preflight');
const logDir=runDirectory('release',runId);
const identity=sourceIdentity();
const results=[];
const push=r=>{results.push(r);process.stderr.write(`  ${r.status.padEnd(7)} ${r.title}${r.detail?'  — '+r.detail:''}\n`);return r;};
const stop=()=>results.some(r=>r.status===STATUS.FAIL);
const time=async(fn)=>{const s=Date.now();const r=await fn();if(!r.durationMs)r.durationMs=Date.now()-s;return r;};

process.stderr.write(`release:preflight  stage=${stage}  target=${targetEnv}  commit ${identity.commit.slice(0,12)}\n`);

// 1 identity of the source
const clean=checkCleanRevision({allowDirty:flag('allow-dirty')});push(clean);
push(checkNode());push(await time(()=>checkDependencies()));
push(checkWorkingTreeHasNoHospitalData());
push(checkResources({where:repoRoot}));

// 2 clinical inputs, environment identity, signing prerequisites
push(await time(checkAssets));
push(await time(checkEnvironmentIdentity));
push(checkSigningPrerequisite(targetEnv));

// 3 provenance of the release identity
{
 const s=Date.now();
 try{
  const v=readJson(path.join(repoRoot,'deploy','windows','app-version.json')).appVersion;
  const gates=await import(pathToFileURL(path.join(repoRoot,'deploy','windows','deploy-gates.mjs')).href);
  const rid=gates.releaseId(v,identity.commit);
  push(passed('provenance','Release identity derivable (app version + exact commit)',Date.now()-s,{detail:`${rid}`}));
 }catch(e){push(failed('provenance','Release identity derivable (app version + exact commit)',e.message,'Fix deploy/windows/app-version.json (x.y.z).'));}
}

// 4 database: migration order, checksums, rehearsal on a synthetic database, destructive statements, rollback class
const base=value('base')??git(['merge-base','HEAD','main'],{allowFail:true})??'HEAD~1';
let rehearsal=null;
push(await time(checkMigrationInventory));
if(!stop()){
 const r=await runStep({id:'migration-rehearsal',title:`Migration rehearsal on a synthetic database (base ${base.slice(0,12)})`,command:process.execPath,args:['--import','tsx',path.join('tools','dev','migration-check.mjs'),'--base',base,'--json'],cwd:repoRoot,env:childEnvironment(),logDir,
  hint:'Applied migrations are immutable: never edit one; add a new numbered migration. Fix the check named in the log.'});
 if(r.status===STATUS.PASS){
  try{rehearsal=JSON.parse(readFileSync(path.join(repoRoot,r.logFile),'utf8').trim().split('\n').pop());r.detail=`${rehearsal.checks.length} checks, ${rehearsal.pending.length} pending`;}catch{/* detail only */}
 }
 push(r);
 if(rehearsal){
  push(rehearsal.destructive.length
   ?{...passed('destructive','Destructive migration detection',0,{detail:`${rehearsal.destructive.length} migration(s) contain DROP/TRUNCATE/DELETE/ALTER…: ${rehearsal.destructive.map(d=>d.migration).join(', ')}`}),requiresApproval:rehearsal.destructive}
   :passed('destructive','Destructive migration detection',0,{detail:'no destructive statement in pending migrations'}));
  push(passed('rollback-class','Rollback compatibility',0,{detail:rehearsal.pending.length?`${rehearsal.pending.length} pending migration(s): application-only rollback is NOT possible after they run; recovery is the verified pre-upgrade backup restore`:'no pending migration: the previous release can be switched back directly (application-only rollback)'}));
 }
}

// 5 risk classification of the candidate (the same rules the Production gate applies)
{
 const s=Date.now();
 try{
  const rc=await import(pathToFileURL(path.join(repoRoot,'deploy','windows','risk-classification.mjs')).href);
  const rows=git(['diff','--name-status','--no-color','--find-renames',`${base}..HEAD`]).split('\n').filter(Boolean).flatMap(l=>{const p=l.split('\t');return p.slice(1).map(x=>({status:p[0],path:x}));});
  const c=rc.withPendingMigrations(rc.classifyChange({files:rows}),rehearsal?.pending??[]);
  push(passed('risk','Risk classification of the candidate',Date.now()-s,{detail:`${c.level} (${c.files} file(s) vs ${base.slice(0,12)}); HIGH areas: ${[...new Set(c.reasons.filter(r=>r.level==='HIGH').map(r=>r.rule))].slice(0,4).join('; ')||'none'}`,level:c.level,requires:c.requires}));
 }catch(e){push(failed('risk','Risk classification of the candidate',e.message,'git history for the base revision is needed (fetch full history).'));}
}

if(stage==='full'&&!stop()){
 const env=childEnvironment();const common={cwd:repoRoot,env,logDir};
 // 6 source validation and regression
 push(await runStep({id:'typecheck',title:'TypeScript (next typegen + tsc --noEmit)',command:process.execPath,args:[TOOLS.next,'typegen'],hint:'Fix the route/page signature named in the output.',...common}).then(async g=>g.status!==STATUS.PASS?g:runStep({id:'typecheck2',title:'TypeScript (next typegen + tsc --noEmit)',command:process.execPath,args:[TOOLS.tsc,'--noEmit'],hint:'Fix the first error (file:line); iterate with npm run dev:verify.',...common})));
 if(!stop())push(await runStep({id:'lint',title:'ESLint (whole project, zero warnings)',command:process.execPath,args:[TOOLS.eslint,'.','--max-warnings','0','--cache','--cache-location',path.join(repoRoot,'.local','release','eslint.cache')],hint:'Fix the reported violations.',...common}));
 if(!stop()){
  const contracts=readdirSync(path.join(repoRoot,'tests','deploy')).filter(f=>f.endsWith('.node.mjs')).map(f=>'tests/deploy/'+f);
  push(await runStep({id:'deploy',title:`Deployment contracts (${contracts.length} files)`,command:process.execPath,args:['--test',...contracts],hint:'A gate/installer contract changed: fix the code unless the Owner changed the policy.',...common}));
 }
 if(!stop()){
  const changed=git(['diff','--name-only','--no-renames',`${base}..HEAD`]).split('\n').filter(f=>/\.(ts|tsx|mjs)$/.test(f)&&existsSync(path.join(repoRoot,f))&&!/^(deploy|tests\/deploy|tools\/(win-installer|dev|release))\//.test(f));
  if(flag('full'))push(await runStep({id:'regression',title:'Complete vitest suite (release qualification)',command:process.execPath,args:[TOOLS.vitest,'run'],timeoutMs:60*60_000,hint:'Re-run the failing file alone with npm run dev:test -- <file>.',...common}));
  else if(changed.length)push(await runStep({id:'regression',title:`Related regression tests (${changed.length} changed source file(s))`,command:process.execPath,args:[TOOLS.vitest,'related','--run','--passWithNoTests',...changed],timeoutMs:45*60_000,hint:'Re-run the failing file alone with npm run dev:test -- <file>. Use --full for the entire suite.',...common}));
  else push(skipped('regression','Related regression tests','no changed source file'));
 }
 // 7 production build correctness + provenance (the stamp is what build-package.ts --skip-build later verifies)
 if(!stop()){
  if(flag('no-build'))push(skipped('build','Production build + provenance stamp','--no-build'));
  else{
   const prior=verifyBuildStamp(repoRoot,identity.commit);
   if(prior.ok)push(passed('build','Production build + provenance stamp',0,{detail:`reused: .next already built from this exact commit and inputs (BUILD_ID ${prior.stamp.buildId})`}));
   else{
    const cacheRoot=process.env.NIPT_BUILD_CACHE_DIR;const restored=restoreBuildCache(repoRoot,cacheRoot);
    const b=await runStep({id:'build',title:'Production build (next build) + provenance stamp',command:process.execPath,args:[TOOLS.next,'build'],timeoutMs:40*60_000,hint:'The build failed deterministically: no package can be made from this commit. Fix the error shown, then npm run dev:verify.',...common,env:{...env,NODE_ENV:'production'}});
    if(b.status===STATUS.PASS){
     try{const st=writeBuildStamp(repoRoot,identity.commit);const saved=saveBuildCache(repoRoot,cacheRoot);b.detail=`BUILD_ID ${st.buildId}; compilation cache ${restored.restored?'restored':'cold ('+restored.reason+')'}, ${saved.saved?'saved':'not saved'}`;}
     catch(e){b.status=STATUS.FAIL;b.reason='build finished but the stamp could not be written: '+e.message;}
    }
    push(b);
   }
  }
 }
}

const total=Date.now()-t0;
const v=verdict(results);
const report={format:'NIPT_RELEASE_PREFLIGHT_V1',runId,stage,targetEnvironment:targetEnv,commit:identity.commit,branch:identity.branch,base,machine:machineFacts(),results,verdict:v.status,totalMs:total,
 requiresApproval:results.flatMap(r=>r.requiresApproval??[]),buildCacheKey:(()=>{try{return cacheKey(repoRoot);}catch{return null;}})(),at:new Date().toISOString()};
const reportFile=writeReport(logDir,'preflight.json',report);
// the record the deployment scripts look for: exactly this commit, written whatever the verdict
try{
 const dir=path.join(repoRoot,'.local','release','preflight');
 const {mkdirSync,writeFileSync}=await import('node:fs');mkdirSync(dir,{recursive:true});writeFileSync(path.join(dir,`${identity.commit}.${stage}.json`),JSON.stringify(report,null,1));
}catch{/* the run folder holds the record */}
if(flag('json'))process.stdout.write(JSON.stringify(report)+'\n');
else process.stdout.write(renderSummary({title:`release:preflight (${stage}, target ${targetEnv})`,results,identity,environment:'build host (read-only checks; nothing is deployed)',totalMs:total,reportFile})+'\n');
process.exitCode=v.exitCode;
