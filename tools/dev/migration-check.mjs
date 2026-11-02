// Migration safety rehearsal on a throw-away in-memory PostgreSQL (PGlite). It never connects to any real database, so it cannot touch Staging or Production.
//   node --import tsx tools/dev/migration-check.mjs [--base <git ref>] [--dir db/migrations] [--json]
// It reuses the real migration engine (tools/migrate.ts) and the real destructive-SQL detector (deploy/windows/deploy-gates.mjs); it adds no second engine.
//  1 apply every migration to an empty database                                  → the whole chain is valid SQL and ordered
//  2 run the engine again                                                        → nothing is re-applied (ledger rows and applied_at unchanged)
//  3 edit an applied migration (in a scratch copy)                               → rejected: checksum mismatch
//  4 remove an applied migration / add one numbered before the last applied one  → rejected: missing / backdated
//  5 --base: apply the migrations of <ref> first, then the pending ones          → pending migrations run on the schema that exists today, not just on an empty one
//  6 --base: a migration present at <ref> that was edited, deleted or renamed    → rejected (applied migrations are immutable)
//  7 destructive statements in the pending migrations                            → listed (a person must approve them before Production)
import {mkdtemp,mkdir,readdir,readFile,writeFile,rm,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..','..');

async function engine(){
 const {migrate}=await import(pathToFileURL(path.join(root,'tools','migrate.ts')).href);
 const {PGlite}=await import('@electric-sql/pglite');
 const {destructiveStatements}=await import(pathToFileURL(path.join(root,'deploy','windows','deploy-gates.mjs')).href);
 const {migrationChecksumMatches}=await import(pathToFileURL(path.join(root,'tools','migration-checksums.ts')).href);
 return {migrate,PGlite,destructiveStatements,migrationChecksumMatches};
}
const sqlFiles=async dir=>(await readdir(dir)).filter(f=>/^\d+.*\.sql$/.test(f)).sort();
const ledgerOf=async db=>(await db.query('SELECT name,checksum,applied_at::text AS applied_at FROM schema_migration ORDER BY name')).rows;
const rejects=async(fn,pattern)=>{try{await fn();return {rejected:false,message:null};}catch(e){return {rejected:pattern.test(String(e.message)),message:String(e.message).slice(0,200)};}};

export async function rehearse({dir=path.join(root,'db','migrations'),base=null,gitRoot=root}={}){
 const {migrate,PGlite,destructiveStatements,migrationChecksumMatches}=await engine();
 const checks=[];const record=(id,ok,detail)=>checks.push({id,ok,detail});
 const names=await sqlFiles(dir);
 record('migration-files-found',names.length>0,`${names.length} migration file(s)`);
 const numbers=names.map(n=>Number(n.match(/^\d+/)[0]));
 record('migration-numbers-unique-and-increasing',numbers.every((n,i)=>i===0||n>numbers[i-1]),'file numbers strictly increase');

 // 1 + 2: fresh database, then again
 const db=new PGlite();
 const t0=Date.now();
 await migrate(db,dir);
 const first=await ledgerOf(db);
 record('apply-all-to-empty-database',first.length===names.length,`${first.length} applied in ${Date.now()-t0} ms`);
 await migrate(db,dir);
 const second=await ledgerOf(db);
 record('second-run-reapplies-nothing',JSON.stringify(first)===JSON.stringify(second),'ledger rows and applied_at identical after a second run');

 // 3 + 4 on a scratch copy
 const scratch=await mkdtemp(path.join(tmpdir(),'nipt-migcheck-'));
 try{
  const copy=path.join(scratch,'m');await cp(dir,copy,{recursive:true});
  const target=names[names.length-1];
  await writeFile(path.join(copy,target),(await readFile(path.join(copy,target),'utf8'))+'\n-- tampered\n');
  const tamper=await rejects(()=>migrate(db,copy),/checksum mismatch/i);
  record('edited-applied-migration-rejected',tamper.rejected,tamper.message??'NOT REJECTED');
  await cp(path.join(dir,target),path.join(copy,target));
  await rm(path.join(copy,names[0]));
  const missing=await rejects(()=>migrate(db,copy),/missing from bundle/i);
  record('removed-applied-migration-rejected',missing.rejected,missing.message??'NOT REJECTED');
  await cp(path.join(dir,names[0]),path.join(copy,names[0]));
  await writeFile(path.join(copy,'000_backdated_probe.sql'),'SELECT 1;');
  const backdated=await rejects(()=>migrate(db,copy),/backdated/i);
  record('backdated-migration-rejected',backdated.rejected,backdated.message??'NOT REJECTED');
 }finally{await rm(scratch,{recursive:true,force:true});await db.close?.();}

 // 5 + 6 + 7 against a base revision
 const pending=[];let destructive=[];
 if(base){
  const rel=path.relative(gitRoot,dir).replaceAll('\\','/');
  const git=args=>execFileSync('git',args,{cwd:gitRoot,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  const status=git(['diff','--name-status','--no-renames',base,'--',rel]).split('\n').filter(Boolean).map(l=>{const [s,...p]=l.split('\t');return {status:s,path:p.join('\t')};});
  const untracked=git(['ls-files','--others','--exclude-standard','--',rel]).split('\n').filter(Boolean);
  const changed=status.filter(s=>s.status!=='A');
  // the historical ledger exceptions (CRLF working copies) are the only accepted byte differences, exactly as the engine treats them
  const reallyChanged=[];
  for(const c of changed){
   if(c.status==='M'){
    const name=path.basename(c.path);
    const was=execFileSync('git',['show',`${base}:${c.path}`],{cwd:gitRoot});
    const now=await readFile(path.join(gitRoot,c.path));
    const h=b=>import('node:crypto').then(m=>m.createHash('sha256').update(b.toString('utf8')).digest('hex'));
    if(migrationChecksumMatches(name,await h(now),await h(was)))continue;
   }
   reallyChanged.push(`${c.status} ${path.basename(c.path)}`);
  }
  record('applied-migrations-unchanged-since-base',reallyChanged.length===0,reallyChanged.length?`changed since ${base}: ${reallyChanged.join(', ')}`:`no migration present at ${base} was edited, deleted or renamed`);
  const baseNames=git(['ls-tree','--name-only',base,rel+'/']).split('\n').filter(Boolean).map(p=>path.basename(p)).filter(n=>/^\d+.*\.sql$/.test(n));
  for(const n of names)if(!baseNames.includes(n))pending.push(n);
  record('pending-migrations-identified',true,pending.length?`${pending.length} pending: ${pending.join(', ')}`:`none pending against ${base}`);
  if(pending.length){
   const staged=await mkdtemp(path.join(tmpdir(),'nipt-migbase-'));
   try{
    await mkdir(path.join(staged,'base'));
    for(const n of baseNames)await writeFile(path.join(staged,'base',n),execFileSync('git',['show',`${base}:${rel}/${n}`],{cwd:gitRoot,maxBuffer:64*1024*1024}));
    const upgrade=new PGlite();
    await migrate(upgrade,path.join(staged,'base'));
    const before=(await ledgerOf(upgrade)).length;
    await migrate(upgrade,dir);
    const after=await ledgerOf(upgrade);
    record('pending-applied-on-top-of-base-schema',after.length===before+pending.length,`${before} → ${after.length} applied rows`);
    await upgrade.close?.();
   }catch(e){record('pending-applied-on-top-of-base-schema',false,String(e.message).slice(0,300));}
   finally{await rm(staged,{recursive:true,force:true});}
   for(const n of pending){const hits=destructiveStatements(await readFile(path.join(dir,n),'utf8'));if(hits.length)destructive.push({migration:n,statements:hits});}
   record('destructive-statements-in-pending',true,destructive.length?`${destructive.length} migration(s) need explicit approval before Production: ${destructive.map(d=>d.migration).join(', ')}`:'none');
  }
  void untracked;
 }
 return {ok:checks.every(c=>c.ok),checks,pending,destructive,base};
}

const cli=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(cli){
 const arg=n=>{const i=process.argv.indexOf('--'+n);return i<0?undefined:process.argv[i+1];};
 const result=await rehearse({dir:arg('dir')?path.resolve(arg('dir')):undefined,base:arg('base')??null});
 if(process.argv.includes('--json'))process.stdout.write(JSON.stringify(result)+'\n');
 else for(const c of result.checks)process.stdout.write(`${c.ok?'ok  ':'FAIL'} ${c.id}: ${c.detail}\n`);
 process.exitCode=result.ok?0:1;
}
