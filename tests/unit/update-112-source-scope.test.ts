import {it,expect} from 'vitest';
import {readdirSync,readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const BASE='c237da440dd0e007b2a94bca6438c3dce5fdcc43';
it('installed baseline migration 157 has identical bytes; only new NAS migrations are allowed',()=>{
 const p='db/migrations/157_admin_direct_system_settings.sql';
 const original=execFileSync('git',['show',BASE+':'+p]);
 expect(readFileSync(p)).toEqual(original);
 const latest=readdirSync('db/migrations').filter(n=>/^\d{3}_.*\.sql$/.test(n)&&Number(n.slice(0,3))>157).sort();
 // 161: owner decision 2026-11-01 (single APP_ADMIN) - only the acting-user role predicates of existing guards (see the file)
 // 162-175: owner-approved historical migration bridge (migration_* tables, original-identifier and result-release guards, allocator handover gate);
 // they wrap the CURRENT p6_release_eligible / p5_operational_release_guard definitions, so they must stay numbered after 161.
 expect(latest).toEqual(['158_pdf_archive.sql','159_pdf_archive_retry.sql','160_pdf_archive_worker_recovery.sql','161_app_admin_operator_authority.sql','162_migration_sources_identifiers.sql','163_migration_halos_run_lineage.sql','164_migration_operational_binding.sql','165_migration_result_release.sql','166_migration_his_presence.sql','167_migration_allocator_handover.sql','168_migration_pet_archive_unknown_mtime.sql','169_migration_review_provenance_lock.sql','170_migration_execution_ward_mapping.sql','171_migration_historical_attempt_source.sql','172_migration_rerun_continuation.sql','173_migration_allocator_safe_sequence_cast.sql','174_migration_reserved_number_helper.sql','175_migration_prepared_allocator_guard.sql']);
 expect(readFileSync('db/migrations/159_pdf_archive_retry.sql','utf8')).not.toMatch(/CREATE FUNCTION|SECURITY DEFINER|GRANT EXECUTE/i);
});
it('offline installer requires one exact installed source and remains update-only',()=>{
 const src=readFileSync('tools/win-installer/build-setup.ts','utf8');
 expect(src).toContain('UPDATE_PACKAGE_BASE_REVISION_MISMATCH');
 expect(src).toContain('UPDATE_REQUIRES_PRODUCTION_PROFILE_AND_BASE_REVISION');
 const pkg=readFileSync('tools/win-installer/build-package.ts','utf8');
 expect(pkg).toContain('requires-installed-revision');
 expect(pkg).toContain('CLEAN_COMMITTED_SOURCE_REQUIRED');
 expect(existsSync('tools/win-installer/setup/NIPT-CBH-Setup.iss')).toBe(true);
 const profile=readFileSync('tools/win-installer/setup/NIPT-CBH-Setup.iss','utf8');
 expect(profile).toContain('NIPT-CBH-Update-');
});
