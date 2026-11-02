// npm run dev:verify — the fast verification of the development loop. It looks at what you changed (git working tree, or --base <ref>) and runs only
// the checks those files need: TypeScript (incremental), ESLint on the changed files (cached), the related unit/DB tests, the deployment contracts,
// the migration rehearsal on an in-memory PostgreSQL and the build-input checks. It builds no package, signs nothing, installs nothing and never
// touches Staging, Production, a real database or the HIS/NAS paths. Release qualification is a different command: npm run release:preflight.
//
//   npm run dev:verify                         changed files vs HEAD (uncommitted work + untracked files)
//   npm run dev:verify -- --base main          everything on this branch vs main, plus uncommitted work
//   npm run dev:verify -- --files packages/p2/service.ts,tests/db/anc-owner-registry.test.ts
//   npm run dev:verify -- --related            also run every test that imports a changed file (slow for core modules)
//   npm run dev:verify -- --only typecheck,tests --json
// Exit code: 0 PASS · 1 FAIL · 2 BLOCKED (a prerequisite is missing; never reported as PASS)
import {readdirSync,existsSync,mkdirSync} from 'node:fs';
import path from 'node:path';

import {repoRoot,TOOLS,STATUS,runStep,skipped,blocked,failed,changedFiles,sourceIdentity,runDirectory,newRunId,renderSummary,verdict,writeReport,machineFacts} from './lib.mjs';
import {selectChecks,directTests} from './select.mjs';
import {childEnvironment} from './dev-env.mjs';
import {checkNode,checkDependencies,checkMigrationInventory} from '../release/checks.mjs';

const args=process.argv.slice(2);
const flag=n=>args.includes('--'+n);
const value=n=>{const i=args.indexOf('--'+n);return i<0?undefined:args[i+1];};
const only=value('only')?new Set(value('only').split(',')):null;
const want=id=>!only||only.has(id);

const listTests=dir=>{const out=[];const walk=d=>{for(const e of readdirSync(path.join(repoRoot,d),{withFileTypes:true})){const rel=d+'/'+e.name;if(e.isDirectory())walk(rel);else if(/\.test\.ts$/.test(e.name))out.push(rel);}};if(existsSync(path.join(repoRoot,dir)))walk(dir);return out;};

const t0=Date.now();
const runId=newRunId('verify');
const logDir=runDirectory('dev',runId);
const identity=sourceIdentity();
const base=value('base')??'HEAD';
const files=value('files')?value('files').split(',').map(s=>s.trim()).filter(Boolean):changedFiles({base});
const plan=selectChecks(files,listTests('tests'));
const direct=directTests(plan);
const results=[];
const push=r=>{results.push(r);if(!flag('quiet'))process.stderr.write(`  ${r.status.padEnd(7)} ${r.title} ${r.status===STATUS.SKIPPED?'('+r.reason+')':''}\n`);return r;};

if(!flag('quiet'))process.stderr.write(`dev:verify  ${files.length} changed file(s) vs ${base}${plan.nothingToCheck?' — nothing to check':''}\n`);

let env;
try{env=childEnvironment();}
catch(e){push(failed('isolation','Development environment is isolated from Staging/Production/HIS',e.message,'Fix the variable named in the message; development must use only the 127.0.0.1 ports and .local/dev paths in docs/deployment/FAST-DEVELOPMENT-PIPELINE.md.'));}

if(env){
 if(want('toolchain')){
  push(checkNode());
  const deps=checkDependencies();push(deps);
  if(deps.status===STATUS.BLOCKED||deps.status===STATUS.FAIL){
   // without dependencies nothing below can run: say so once instead of failing every step differently
   for(const [id,title] of [['typecheck','TypeScript'],['lint','ESLint'],['tests','Related tests']])push(blocked(id,title,'dependencies are not installed/consistent','npm ci'));
   plan.nothingToCheck=true;
  }
 }
 if(!plan.nothingToCheck){
  const common={cwd:repoRoot,env,logDir};
  const steps=[];
  if(plan.typecheck&&want('typecheck')){
   steps.push((async()=>{
    // route types are generated from src/app; skip the (slow) generation unless a route file changed or the types are missing
    if(plan.typegen||!existsSync(path.join(repoRoot,'.next','types'))){
     const g=await runStep({id:'typegen',title:'next typegen (route types)',command:process.execPath,args:[TOOLS.next,'typegen'],hint:'A route/page signature is invalid; fix the file named in the output.',...common});
     if(g.status!==STATUS.PASS)return push(g);
    }
    return push(await runStep({id:'typecheck',title:'TypeScript (tsc --noEmit, incremental)',command:process.execPath,args:[TOOLS.tsc,'--noEmit'],hint:'Fix the first error (file:line) and run: npm run dev:verify -- --only typecheck',...common}));
   })());
  }else push(skipped('typecheck','TypeScript',plan.typecheck?'not selected':'no .ts/.tsx change'));
  if(plan.lint.length&&want('lint')){
   mkdirSync(path.join(repoRoot,'.local','dev'),{recursive:true});
   steps.push(runStep({id:'lint',title:`ESLint (${plan.lint.length} changed file(s), cached)`,command:process.execPath,args:[TOOLS.eslint,'--max-warnings','0','--cache','--cache-location',path.join(repoRoot,'.local','dev','eslint.cache'),...plan.lint.filter(f=>existsSync(path.join(repoRoot,f)))],hint:'Fix the reported rule violations; try --fix for formatting rules.',...common}).then(push));
  }else push(skipped('lint','ESLint','no JS/TS file changed'));
  await Promise.all(steps);

  // default = changed test files + the focused suites of each touched area (seconds). --related also runs every test that imports a changed file; for a core
  // module such as packages/p2 that import graph reaches dozens of files (minutes), so that wider net belongs to release:preflight.
  const relatedSources=flag('related')?plan.related:[];
  const testTargets=[...new Set([...relatedSources,...direct])].filter(f=>existsSync(path.join(repoRoot,f)));
  if(testTargets.length&&want('tests')){
   const why=[relatedSources.length?`${relatedSources.length} source`:null,direct.length?`${direct.length} direct`:null].filter(Boolean).join(' + ');
   push(await runStep({id:'tests',title:`Focused tests (${testTargets.length} file(s): ${why})`,command:process.execPath,args:[TOOLS.vitest,'related','--run','--passWithNoTests',...testTargets],
    hint:'Re-run only the failing test: node node_modules/vitest/vitest.mjs run <file> -t "<test name>"  (vitest prints the file and assertion).',treatAsBlocked:(out)=>/ECONNREFUSED|connect ECONNREFUSED/.test(out),...common}));
  }else push(skipped('tests','Focused tests','no changed test and no area suite selected (add --related to follow imports)'));
  if(plan.areas.length)for(const a of plan.areas)if(!flag('quiet'))process.stderr.write(`          area: ${a.label} → ${a.tests.length} focused test file(s) included\n`);

  if(plan.deployContracts&&want('deploy')){
   const contracts=readdirSync(path.join(repoRoot,'tests','deploy')).filter(f=>f.endsWith('.node.mjs')).map(f=>'tests/deploy/'+f);
   push(await runStep({id:'deploy',title:`Deployment contracts (${contracts.length} files)`,command:process.execPath,args:['--test',...contracts],hint:'A deployment gate, installer or release contract changed behaviour. Read the first failing assertion; fix the code, not the test, unless the policy itself changed.',...common}));
  }else push(skipped('deploy','Deployment contracts','no deploy/installer/dev-tool file changed'));

  if(plan.migration&&want('migration')){
   const r=await runStep({id:'migration',title:'Migration rehearsal (in-memory PostgreSQL)',command:process.execPath,args:['--import','tsx',path.join('tools','dev','migration-check.mjs'),'--base',base,'--json'],hint:'A migration is invalid, was edited after being applied, or is numbered out of order. Applied migrations are immutable: add a new numbered migration instead.',...common});
   if(r.logFile&&r.status===STATUS.PASS){
    try{const rep=JSON.parse((await import('node:fs')).readFileSync(path.join(repoRoot,r.logFile),'utf8').trim().split('\n').pop());r.detail=`${rep.checks.length} checks, ${rep.pending.length} pending, ${rep.destructive.length} destructive`;if(rep.destructive.length)r.warning='destructive statements need explicit approval before Production: '+rep.destructive.map(d=>d.migration).join(', ');}catch{/* summary only */}
   }
   push(r);
   if(r.status===STATUS.PASS){const inv=await checkMigrationInventory();push(inv);}
  }else push(skipped('migration','Migration rehearsal','no migration or migration-engine file changed'));

  if(plan.buildInputs&&want('build-inputs')){
   // cheap, deterministic build-input checks; the full set (assets, signing, provenance) belongs to release:preflight
   push(checkDependencies());
  }
 }else if(!results.length)push(skipped('nothing','No changes','no changed files found — edit something, or pass --base <ref> / --files <list>'));
}

const total=Date.now()-t0;
const v=verdict(results);
const report={format:'NIPT_DEV_VERIFY_V1',runId,base,identity,environment:'development (synthetic, 127.0.0.1, .local/dev)',machine:machineFacts(),changedFiles:plan.files,plan:{typecheck:plan.typecheck,lint:plan.lint.length,related:plan.related.length,directTests:direct.length,areas:plan.areas.map(a=>a.area),deployContracts:plan.deployContracts,migration:plan.migration},results,verdict:v.status,totalMs:total,startedAt:new Date(t0).toISOString()};
const reportFile=writeReport(logDir,'verify.json',report);
if(flag('json'))process.stdout.write(JSON.stringify(report)+'\n');
else process.stdout.write(renderSummary({title:'dev:verify',results,identity,environment:report.environment,totalMs:total,reportFile})+'\n');
process.exitCode=v.exitCode;

