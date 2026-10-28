import {it,expect} from 'vitest';
import {readdirSync,readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const BASE='c237da440dd0e007b2a94bca6438c3dce5fdcc43';
it('installed baseline migration 157 has identical bytes; only new NAS migrations are allowed',()=>{
 const p='db/migrations/157_admin_direct_system_settings.sql';
 const original=execFileSync('git',['show',BASE+':'+p]);
 expect(readFileSync(p)).toEqual(original);
 const latest=readdirSync('db/migrations').filter(n=>/^\d{3}_.*\.sql$/.test(n)&&Number(n.slice(0,3))>157).sort();
 expect(latest).toEqual(['158_pdf_archive.sql','159_pdf_archive_retry.sql','160_pdf_archive_worker_recovery.sql']);
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
