import {beforeAll,afterAll,it,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase} from '../helpers/database';
import {migrationCompatibility,REQUIRED_MIGRATIONS,BASELINE_LAST_MIGRATION} from '../../packages/migration/compatibility';

// The server states its own compatibility with the Full Installation 1.1.0 baseline; Migration.exe trusts that report, never a version number.
let db:PGlite;
beforeAll(async()=>{db=await testDatabase();});
afterAll(async()=>{await db.close();});

it('a fully migrated server reports compatible with every required migration and capability',async()=>{
 const r=await migrationCompatibility(db as never,{});
 expect(r).toMatchObject({format:'NIPT_HISTORICAL_MIGRATION_COMPAT_V1',baselineFullInstallation:'1.1.0',baselineLedgerPresent:true,missingMigrations:[],compatible:true,reasons:[]});
 expect(r.requiredMigrations).toBe(REQUIRED_MIGRATIONS.length);expect(r.capabilities).toContain('VERIFIED_BACKUP_GATE');
});
it('a v1.1.0 ledger (ends at 142) reports incompatible with the exact missing migrations',async()=>{
 await db.query('BEGIN');
 try{
  await db.query("DELETE FROM schema_migration WHERE name ~ '^(16[2-9]|17[0-5])_'");
  const r=await migrationCompatibility(db as never,{});
  expect(r.baselineLedgerPresent).toBe(true);expect(BASELINE_LAST_MIGRATION).toBe('142_run_release_ignores_photos.sql');
  expect(r.missingMigrations).toHaveLength(14);expect(r.compatible).toBe(false);expect(r.reasons).toEqual(['MIGRATION_SUPPORT_MIGRATIONS_MISSING']);
 }finally{await db.query('ROLLBACK');}
});
it('a ledger without the 1.1.0 baseline is never compatible',async()=>{
 await db.query('BEGIN');
 try{await db.query("DELETE FROM schema_migration WHERE name='142_run_release_ignores_photos.sql'");const r=await migrationCompatibility(db as never,{});expect(r.compatible).toBe(false);expect(r.reasons).toContain('BASELINE_LEDGER_INCOMPLETE');}
 finally{await db.query('ROLLBACK');}
});
