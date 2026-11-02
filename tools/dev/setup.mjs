// npm run dev:setup — one-time (and repeatable) preparation of the isolated development workspace under .local/dev:
//   keys and secrets (synthetic, random), a private PostgreSQL 17 cluster on 127.0.0.1:55452, the database nipt_synthetic_dev with the real migrations,
//   least-privilege logins, and synthetic seed users. Idempotent: existing keys, cluster and data are preserved.
//   --reset-db   drop and recreate ONLY nipt_synthetic_dev, then migrate and seed again
//   --skip-seed  do not create the synthetic users/cases
import {mkdirSync,existsSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
import {repoRoot} from './lib.mjs';
import {DEV_HOME,DEV_DATA,DEV_DATABASE,DEV_PORTS,childEnvironment,isolationViolations,devEnvironment} from './dev-env.mjs';
import {pgBin,pgStatus,initCluster,startCluster,adminUrl} from './pg.mjs';

const args=process.argv.slice(2);
const say=m=>process.stdout.write(m+'\n');
const die=(code,hint)=>{process.stderr.write(`dev:setup FAILED: ${code}\n  next: ${hint}\n`);process.exit(1);};

const violations=isolationViolations({...devEnvironment(),...{NIPT_MODE:'synthetic'}});
if(violations.length)die('DEV_ISOLATION_VIOLATION '+violations.map(v=>v.code+' '+v.detail).join('; '),'the built-in development configuration must never break isolation; this is a defect in tools/dev/dev-env.mjs');
const env=childEnvironment();

for(const d of ['files','simulator','keys','secrets'])mkdirSync(path.join(DEV_DATA,d),{recursive:true});
say(`workspace  ${DEV_HOME}`);

// 1 keys and secrets (existing files are preserved by tools/init-dev.ts); it runs INSIDE .local/dev so ./data resolves there
{
 const r=spawnSync(process.execPath,['--import','tsx',path.join(repoRoot,'tools','init-dev.ts')],{cwd:DEV_HOME,env,encoding:'utf8',windowsHide:true});
 if(r.status!==0)die('INIT_DEV_FAILED '+(r.stderr||r.stdout).slice(-300),'run: node --import tsx tools/init-dev.ts from inside .local/dev and read the error');
 say('keys      synthetic keys and secrets ready (outside Git)');
}

// 2 database server
const bin=pgBin();
if(!bin)die('POSTGRESQL_17_BINARIES_NOT_FOUND','install PostgreSQL 17 client/server binaries or set NIPT_PG_HOME (the deployment server already has C:\\Program Files\\PostgreSQL\\17)');
if(pgStatus(bin)==='absent'){say('database  creating private cluster (127.0.0.1:'+DEV_PORTS.postgres+', 64 MB buffers, 30 connections)');initCluster(bin);}
if(pgStatus(bin)!=='running'){say('database  starting');startCluster(bin);}
say(`database  running on 127.0.0.1:${DEV_PORTS.postgres}`);

// 3 database + migrations + logins + seed
const admin=new pg.Client({connectionString:adminUrl});await admin.connect();
try{
 if(args.includes('--reset-db')){
  if(DEV_DATABASE!=='nipt_synthetic_dev')die('REFUSED','only nipt_synthetic_dev may be dropped');
  await admin.query(`DROP DATABASE IF EXISTS ${DEV_DATABASE} WITH (FORCE)`);say('database  nipt_synthetic_dev dropped');
 }
 const has=await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[DEV_DATABASE]);
 if(!has.rowCount){await admin.query(`CREATE DATABASE ${DEV_DATABASE}`);say('database  nipt_synthetic_dev created');}
}finally{await admin.end();}

const tsx=(script,label)=>{
 const r=spawnSync(process.execPath,['--import','tsx',path.join(repoRoot,'tools',script)],{cwd:repoRoot,env,encoding:'utf8',windowsHide:true});
 if(r.status!==0)die(`${label.toUpperCase().replace(/ /g,'_')}_FAILED ${(r.stderr||r.stdout).trim().slice(-400)}`,`run: npm run dev:setup again after fixing the cause; the step is repeatable`);
 say(`database  ${label}`);
};
tsx('prepare-db.ts','migrations, queue schema and logins applied');
if(!args.includes('--skip-seed'))tsx('seed.ts','synthetic users and sample cases seeded');

writeFileSync(path.join(DEV_HOME,'dev-setup.json'),JSON.stringify({format:'NIPT_DEV_SETUP_V1',at:new Date().toISOString(),ports:DEV_PORTS,database:DEV_DATABASE,postgres:bin},null,1));
const seedPassword=existsSync(path.join(DEV_DATA,'secrets','seed-password'))?'(see .local/dev/data/secrets/seed-password)':'(unset)';
say(`\nReady. Start the app with:  npm run dev      → http://127.0.0.1:${DEV_PORTS.web}`);
say(`Synthetic logins: synthetic.admin / synthetic.lab / synthetic.anc …  password ${seedPassword}`);
