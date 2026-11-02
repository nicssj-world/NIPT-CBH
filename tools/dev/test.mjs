// npm run dev:test -- <vitest file or filter> [-t "name"]   — run focused tests in the isolated development environment (no commit, no package, no deploy).
//   npm run dev:test -- tests/db/anc-owner-registry.test.ts
//   npm run dev:test -- tests/unit/p2-pdf.test.ts -t "renders"
//   npm run dev:test -- --watch tests/unit/pdf.test.ts        (re-runs on every save: edit → test → fix in the same workspace)
import {spawnSync} from 'node:child_process';
import {repoRoot,TOOLS} from './lib.mjs';
import {childEnvironment} from './dev-env.mjs';
const rest=process.argv.slice(2);
if(!rest.length){process.stderr.write('usage: npm run dev:test -- <test file or filter> [vitest options]\n');process.exit(1);}
const watch=rest.includes('--watch');
const args=[TOOLS.vitest,...(watch?[]:['run']),...rest.filter(a=>a!=='--watch')];
const r=spawnSync(process.execPath,args,{cwd:repoRoot,env:childEnvironment(),stdio:'inherit',windowsHide:true});
process.exitCode=r.status??1;
