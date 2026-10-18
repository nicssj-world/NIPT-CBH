import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {mkdtemp,readdir,copyFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {migrate} from '../../tools/migrate';
import type {Queryable} from '../../packages/db/connection';
import {tx,labUsers,setPendingPolicy,syntheticCase,receiveS1} from '../helpers/lab';

// Migration 104 (pagination pass, forward only, synthetic databases only): five additive lookup indexes. Each one exists because the
// per-attempt / per-case facts queries (packages/lab/core.ts attemptFacts, packages/anc/service.ts factsSql) ran a Seq Scan per row.
const FILE='104_pagination_lookup_indexes.sql';
const INDEXES=['p2_paper_review_round_kind','clinical_snapshot_round','specimen_acceptance_round','p2_collection_fact_round_source','label_print_item_round'];
const bundle=async()=>(await readdir('db/migrations')).filter(f=>/^\d+.*\.sql$/.test(f)).sort();
async function before104(){const dir=await mkdtemp(path.join(tmpdir(),'nipt-mig-104-'));for(const f of (await bundle()).filter(f=>f<'104'))await copyFile(path.join('db/migrations',f),path.join(dir,f));return dir;}
async function snapshot(db:Queryable){
 const tables=(await db.query<{t:string}>("SELECT table_name t FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name<>'schema_migration' ORDER BY 1")).rows.map(r=>r.t);
 const out:Record<string,string>={};for(const t of tables){const r=(await db.query<{n:string;d:string|null}>(`SELECT count(*)::text n,md5(string_agg(x::text,'|' ORDER BY x::text)) d FROM "${t}" x`)).rows[0];out[t]=`${r.n}:${r.d??''}`;}return out;
}
it('104 adds only the five lookup indexes: no table or row changes, ledger checksum recorded, idempotent, fresh install identical',async()=>{
 const db=new PGlite(),dir=await before104();
 try{
  await migrate(db,dir);
  const u=await labUsers(db as unknown as Queryable);await setPendingPolicy(db as unknown as Queryable,u,'PROCEED_SYNTHETIC_LABELLED');
  for(let i=0;i<6;i++){const c=await tx(db as unknown as Queryable,t=>syntheticCase(t,u));await tx(db as unknown as Queryable,t=>receiveS1(t,c,new Date(Date.now()-i*60000)));}
  const had=async()=>(await db.query<{indexname:string}>("SELECT indexname FROM pg_indexes WHERE schemaname='public'")).rows.map(r=>r.indexname);
  expect((await had()).filter(n=>INDEXES.includes(n))).toEqual([]);
  const rowsBefore=await snapshot(db as unknown as Queryable);
  await migrate(db);
  expect((await had()).filter(n=>INDEXES.includes(n)).sort()).toEqual([...INDEXES].sort());
  expect(await snapshot(db as unknown as Queryable)).toEqual(rowsBefore); // no data, no table added
  const ledger=async()=>(await db.query<{name:string;checksum:string}>('SELECT name,checksum FROM schema_migration ORDER BY name')).rows;
  const l=await ledger();expect(l.find(r=>r.name===FILE)?.checksum).toBe(createHash('sha256').update(readFileSync(path.join('db/migrations',FILE),'utf8')).digest('hex'));
  await migrate(db);expect(await ledger()).toEqual(l);
  const fresh=new PGlite();try{await migrate(fresh);expect((await fresh.query<{indexname:string}>("SELECT indexname FROM pg_indexes WHERE schemaname='public'")).rows.map(r=>r.indexname).filter(n=>INDEXES.includes(n)).sort()).toEqual([...INDEXES].sort());}finally{await fresh.close();}
 }finally{await db.close();await rm(dir,{recursive:true,force:true});}
},120000);

it('each new index can serve the exact predicate the facts queries use (planner forced off sequential scans, so only an unusable index fails)',async()=>{
 const db=new PGlite();
 try{
  await migrate(db);await db.exec('SET enable_seqscan=off');
  const plan=async(sql:string)=>(await db.query<Record<string,string>>('EXPLAIN (COSTS OFF) '+sql)).rows.map(r=>r['QUERY PLAN']).join('\n');
  const id="'00000000-0000-0000-0000-000000000001'";
  expect(await plan(`SELECT 1 FROM p2_paper_review p WHERE p.round_id=${id} AND p.kind='REQUEST' ORDER BY p.created_at DESC LIMIT 1`)).toContain('p2_paper_review_round_kind');
  expect(await plan(`SELECT 1 FROM clinical_snapshot s WHERE s.round_id=${id} ORDER BY s.created_at DESC LIMIT 1`)).toContain('clinical_snapshot_round');
  expect(await plan(`SELECT condition='ACCEPTABLE' FROM specimen_acceptance WHERE round_id=${id} ORDER BY created_at DESC,id DESC LIMIT 1`)).toContain('specimen_acceptance_round');
  expect(await plan(`SELECT DISTINCT ON(f.source) f.collection_date FROM p2_collection_fact f WHERE f.round_id=${id} ORDER BY f.source,f.sequence DESC`)).toContain('p2_collection_fact_round_source');
  expect(await plan(`SELECT count(*) FROM label_print_item i WHERE i.round_id=${id}`)).toContain('label_print_item_round');
 }finally{await db.close();}
});
