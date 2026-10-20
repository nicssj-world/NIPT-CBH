import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {Client} from 'pg';
import {mkdtemp,readdir,copyFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {migrate} from '../../tools/migrate';
import {assertSyntheticDatabase,type Queryable} from '../../packages/db/connection';
import * as batch from '../../packages/lab/batch';
import {tx,labUsers,setPendingPolicy,syntheticCase,receiveS1} from '../helpers/lab';

// Integration 2026-10-18: Consent refusal and Run Photo Evidence were both filed as migration 102. Consent keeps 102; the photo
// migration is 103 with byte-identical content. Synthetic databases only. Nothing here is a Production apply.
const PHOTO='103_run_photo_evidence.sql',CONSENT='102_p2_paper_consent_refusal.sql';
const PHOTO_SHA='f11c8080b172e2628404c0a8d6476ae1d5c77e625d917c0e72c75836009b03f9';
const sha=(f:string)=>createHash('sha256').update(readFileSync(path.join('db/migrations',f),'utf8')).digest('hex');
const bundle=async()=>(await readdir('db/migrations')).filter(f=>/^\d+.*\.sql$/.test(f)).sort();
async function partial(upTo:string){const dir=await mkdtemp(path.join(tmpdir(),'nipt-mig-103-'));for(const f of (await bundle()).filter(f=>f<upTo))await copyFile(path.join('db/migrations',f),path.join(dir,f));return dir;}

/** Row count and content digest of every public base table, so an upgrade can prove it did not touch existing data. */
async function snapshot(db:Queryable){
 const tables=(await db.query<{t:string}>("SELECT table_name t FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name<>'schema_migration' ORDER BY 1")).rows.map(r=>r.t);
 const out:Record<string,string>={};
 for(const t of tables){const r=(await db.query<{n:string;d:string|null}>(`SELECT count(*)::text n,md5(string_agg(x::text,'|' ORDER BY x::text)) d FROM "${t}" x`)).rows[0];out[t]=`${r.n}:${r.d??''}`;}
 return out;
}
/** Synthetic lab activity on a 102 database: received cases placed into a Run. */
async function seed(db:Queryable){
 const u=await labUsers(db);await setPendingPolicy(db,u,'PROCEED_SYNTHETIC_LABELLED');
 for(let i=0;i<3;i++){const c=await tx(db,t=>syntheticCase(t,u));await tx(db,t=>receiveS1(t,c,new Date(Date.now()-(3-i)*60000)));}
 await tx(db,t=>batch.createBatch(t,u.staff));
 return u;
}
async function upgradeChecks(db:Queryable,dir:string){
 await migrate(db,dir);
 const ledger=async()=>(await db.query<{name:string;checksum:string}>('SELECT name,checksum FROM schema_migration ORDER BY name')).rows;
 expect((await ledger()).map(r=>r.name)).toContain(CONSENT);expect((await ledger()).map(r=>r.name)).not.toContain(PHOTO);
 const u=await seed(db);
 const before=await snapshot(db),ledgerBefore=await ledger(),through103=await partial('104');
 try{await migrate(db,through103);
 const after=await snapshot(db);
 // Every table that existed at 102 is byte-for-byte the same; 103 only adds empty run_photo* tables.
 for(const [t,v] of Object.entries(before))expect(after[t],t).toBe(v);
 const added=Object.keys(after).filter(t=>!(t in before));
 expect(added.length).toBeGreaterThan(0);expect(added.every(t=>t.startsWith('run_photo'))).toBe(true);
 for(const t of added)expect(after[t].startsWith('0:'),t).toBe(true);
 // 099–102 ledger rows are unchanged; 103 is recorded with the checksum the photo branch shipped.
 const now=await ledger();expect(now.slice(0,ledgerBefore.length)).toEqual(ledgerBefore);
 expect(now.find(r=>r.name===PHOTO)).toEqual({name:PHOTO,checksum:PHOTO_SHA});
 // Idempotent: a second run changes nothing.
 await migrate(db,through103);expect(await ledger()).toEqual(now);expect(await snapshot(db)).toEqual(after);
 // The 102-era Lab workflow still runs on the upgraded schema (photos never gate a Run).
 await tx(db,async t=>{const b=(await t.query<{id:string;version:number}>("SELECT id,version FROM lab_batch WHERE state='Draft'")).rows[0];await batch.cancelBatch(t,u.staff,{batchId:b.id,expectedVersion:b.version,reason:'SYNTHETIC post-103 check'});});
 expect((await tx(db,t=>batch.createBatch(t,u.staff))).batchId).toBeTruthy();
 }finally{await rm(through103,{recursive:true,force:true});}
}

it('the bundle has one file per number from 096 on; Consent keeps 102 and Run Photo Evidence is 103 with its original bytes',async()=>{
 const files=await bundle();
 const recent=files.filter(f=>f>='096');const numbers=recent.map(f=>f.slice(0,3));
 expect(new Set(numbers).size).toBe(numbers.length);
 expect(recent.slice(recent.indexOf(CONSENT),recent.indexOf(CONSENT)+2)).toEqual([CONSENT,PHOTO]); // later forward migrations may follow
 expect(sha(PHOTO)).toBe(PHOTO_SHA);expect(files).not.toContain('102_run_photo_evidence.sql');
 expect(readFileSync('docs/migrations.md','utf8')).toContain(`| ${PHOTO} | ${PHOTO_SHA} |`);
});

it('PGlite: fresh install applies 001–103 in order and that prefix is idempotent',async()=>{
 const db=new PGlite(),through103=await partial('104');
 try{
  await migrate(db,through103);const names=(await db.query<{name:string}>('SELECT name FROM schema_migration ORDER BY applied_at,name')).rows.map(r=>r.name);
  expect(names).toEqual((await bundle()).filter(f=>f<'104'));
  await migrate(db,through103);expect((await db.query<{n:number}>('SELECT count(*)::int n FROM schema_migration')).rows[0].n).toBe(names.length);
 }finally{await db.close();await rm(through103,{recursive:true,force:true});}
});

it('PGlite: a populated 102 database upgrades to 103 without changing any existing row',async()=>{
 const db=new PGlite(),dir=await partial('103');
 try{await upgradeChecks(db as unknown as Queryable,dir);}finally{await db.close();await rm(dir,{recursive:true,force:true});}
},120000);

it('a synthetic database migrated on the photo branch (ledger "102_run_photo_evidence.sql") is refused, never silently re-labelled',async()=>{
 const db=new PGlite(),dir=await partial('103');
 try{
  await migrate(db,dir);
  await db.query('INSERT INTO schema_migration(name,checksum) VALUES($1,$2)',['102_run_photo_evidence.sql',PHOTO_SHA]);
  await expect(migrate(db)).rejects.toThrow('Applied migration missing from bundle');
  expect((await db.query<{n:number}>("SELECT count(*)::int n FROM pg_tables WHERE tablename LIKE 'run_photo%'")).rows[0].n).toBe(0);
 }finally{await db.close();await rm(dir,{recursive:true,force:true});}
});

// Native PostgreSQL 17: opt-in, disposable databases created next to the synthetic test database and dropped afterwards.
it.skipIf(!process.env.NIPT_TEST_DATABASE_URL)('native PostgreSQL: fresh install and populated 102 → 103 upgrade preserve data and are idempotent',async()=>{
 const url=process.env.NIPT_TEST_DATABASE_URL!;assertSyntheticDatabase(url);
 const admin=new Client({connectionString:url});await admin.connect();
 const names=[`nipt_synthetic_mig103_fresh_${randomUUID().slice(0,8)}`,`nipt_synthetic_mig103_up_${randomUUID().slice(0,8)}`];
 const dir=await partial('103');
 try{
  for(const n of names)await admin.query(`CREATE DATABASE ${n}`);
  const open=async(n:string)=>{const u=new URL(url);u.pathname=`/${n}`;const c=new Client({connectionString:u.toString()});await c.connect();return c;};
  const fresh=await open(names[0]);
  try{
   expect((await fresh.query<{v:string}>("SELECT current_setting('server_version_num') v")).rows[0].v.startsWith('17')).toBe(true);
   const through103=await partial('104');try{await migrate(fresh,through103);await migrate(fresh,through103);
   expect((await fresh.query<{name:string}>('SELECT name FROM schema_migration ORDER BY name')).rows.map(r=>r.name)).toEqual((await bundle()).filter(f=>f<'104'));}finally{await rm(through103,{recursive:true,force:true});}
  }finally{await fresh.end();}
  const up=await open(names[1]);
  try{await upgradeChecks(up as unknown as Queryable,dir);}finally{await up.end();}
 }finally{
  for(const n of names)await admin.query(`DROP DATABASE IF EXISTS ${n} WITH (FORCE)`);
  await admin.end();await rm(dir,{recursive:true,force:true});
 }
},240000);
