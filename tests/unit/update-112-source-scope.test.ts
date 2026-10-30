import {it,expect} from 'vitest';
import {readdirSync,readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const BASE='c237da440dd0e007b2a94bca6438c3dce5fdcc43';
it('installed baseline migration 157 has identical bytes; 1.1.2 NAS migrations remain unchanged',()=>{
 const p='db/migrations/157_admin_direct_system_settings.sql';
 const original=execFileSync('git',['show',BASE+':'+p]);
 expect(readFileSync(p)).toEqual(original);
 const latest=readdirSync('db/migrations').filter(n=>/^\d{3}_.*\.sql$/.test(n)&&Number(n.slice(0,3))>157).sort();
 expect(latest.slice(0,3)).toEqual(['158_pdf_archive.sql','159_pdf_archive_retry.sql','160_pdf_archive_worker_recovery.sql']);
 expect(latest.slice(3)).toEqual(['161_pet_gate_eqa_case.sql','162_eqa_receipt_and_his_block.sql','163_worker_queue_clear.sql','164_pet_scan_empty_compaction.sql','165_eqa_certification_guard.sql','166_pet_compaction_require_counts.sql','167_archive_clear_privilege.sql','168_archive_clear_lock.sql','169_p6_eqa_his_denial.sql','170_pg_boss_readonly_overview.sql']);
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
