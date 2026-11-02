// npm run dev / dev:up — start development services in the isolated workspace (Hot Reload for the web app).
//   npm run dev                         web only            → http://127.0.0.1:3100   (Next.js dev server, Turbopack, Fast Refresh)
//   npm run dev:up -- web worker        web + job worker (consumes ONLY the dev database queue; never a HIS path)
//   npm run dev:up -- web worker renderer simulator
//   npm run dev:up -- worker --inspect  attach a debugger on 127.0.0.1:9330 (renderer 9331, web 9329)
// Services: web, worker, renderer, simulator. The development PostgreSQL is started when it is not running.
// Every child gets the sanitised development environment (dev-env.mjs): loopback hosts, ports 3100/3101/55452, files under .local/dev. A configuration
// that points anywhere else stops the start. It is NOT the hospital system: nothing here reads HIS folders or writes results to HIS.
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {repoRoot,TOOLS} from './lib.mjs';
import {DEV_HOME,DEV_PORTS,childEnvironment} from './dev-env.mjs';
import {pgBin,pgStatus,startCluster} from './pg.mjs';

const args=process.argv.slice(2);
const inspect=args.includes('--inspect');
const names=args.filter(a=>!a.startsWith('--'));
const services=names.length?names:['web'];
const KNOWN=['web','worker','renderer','simulator'];
const bad=services.filter(s=>!KNOWN.includes(s));
if(bad.length){process.stderr.write(`unknown service(s): ${bad.join(', ')}; choose from ${KNOWN.join(', ')}\n`);process.exit(1);}

if(!existsSync(path.join(DEV_HOME,'dev-setup.json'))){process.stderr.write('The development workspace is not prepared.\n  next: npm run dev:setup\n');process.exit(1);}
const env=childEnvironment();   // throws DEV_ISOLATION_VIOLATION when anything points outside the workspace
const bin=pgBin();
if(!bin){process.stderr.write('PostgreSQL 17 binaries not found (set NIPT_PG_HOME).\n');process.exit(1);}
if(pgStatus(bin)!=='running'){process.stderr.write('starting development PostgreSQL on 127.0.0.1:'+DEV_PORTS.postgres+'\n');startCluster(bin);}

const nodeFlags=['--max-old-space-size=2048'];
const tsx=['--import','tsx'];
const defs={
 web:{cmd:[...nodeFlags,...(inspect?['--inspect=127.0.0.1:9329']:[]),TOOLS.next,'dev','--hostname','127.0.0.1','--port',String(DEV_PORTS.web)],extra:{}},
 worker:{cmd:[...nodeFlags,...(inspect?['--inspect=127.0.0.1:9330']:[]),...tsx,'apps/worker/main.ts'],extra:{}},
 renderer:{cmd:[...nodeFlags,...(inspect?['--inspect=127.0.0.1:9331']:[]),...tsx,'apps/renderer/main.ts'],extra:{RENDERER_HOST:'127.0.0.1',RENDERER_PORT:String(DEV_PORTS.renderer)}},
 simulator:{cmd:[...nodeFlags,...tsx,'tools/his-simulator/main.ts'],extra:{}}
};
const children=[];
const prefix=(name,stream)=>{let buf='';stream.on('data',d=>{buf+=d;const lines=buf.split(/\r?\n/);buf=lines.pop();for(const l of lines)process.stdout.write(`[${name}] ${l}\n`);});};
for(const name of services){
 const d=defs[name];
 const child=spawn(process.execPath,d.cmd,{cwd:repoRoot,env:{...env,...d.extra},windowsHide:true,stdio:['ignore','pipe','pipe']});
 prefix(name,child.stdout);prefix(name,child.stderr);
 child.on('exit',code=>{process.stdout.write(`[${name}] exited (${code})\n`);if(name!=='simulator'){shutdown(code??1);}});
 children.push(child);
}
process.stdout.write(`\nDEVELOPMENT (synthetic data only) — ${services.join(', ')}\n  web  http://127.0.0.1:${DEV_PORTS.web}   renderer http://127.0.0.1:${DEV_PORTS.renderer}   database 127.0.0.1:${DEV_PORTS.postgres}/nipt_synthetic_dev\n  This is not the hospital system. Ctrl+C stops the services (the database keeps running: npm run dev:down).\n\n`);
let closing=false;
function shutdown(code=0){if(closing)return;closing=true;for(const c of children)try{c.kill();}catch{/* already gone */}setTimeout(()=>process.exit(code),500);}
for(const s of ['SIGINT','SIGTERM'])process.on(s,()=>shutdown(0));
