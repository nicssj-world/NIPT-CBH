# NIPT-CBH 1.1.2 — Frozen Release Gates
Owner baseline v1.1.1 source: `c237da440dd0e007b2a94bca6438c3dce5fdcc43`.
Authorized scope: NAS PDF Archive; independent backup/DR; truthful HIS/CFS status; clinical regression/security; Admin health; Exception Center; PDF access audit; operational KPI; scoped UX; Windows **update-only** installer from v1.1.1.
**Historical Genomic-CBH Migration is excluded entirely. No production actions are authorized.**

## Release-gate decision rule
- PASS only on reproducible, saved evidence and relevant end-to-end behavior.
- PARTIAL means implementation exists but required verification is missing.
- A hospital-only real SMB/ACL/service-identity acceptance step can be POST-INSTALL PENDING; do not label it PASS at home.
- No new features or tests outside these gates, except for demonstrated defects/security issues.
- No EXE marked production-ready while a critical development gate fails.

| Gate | Frozen definition | Evidence now | State |
|---|---|---|---|
| R1 | Baseline/worktree separation, migration-157 preserved, no historical import | Worktree correct; source-scope test confirms migration 157 byte-identical to installed revision and only new migrations 158–160 | LOCAL PASS: signed package inventory checked; hospital baseline preflight required |
| R2 | Admin Settings -> worker probe -> enable -> newly released PDF archived with SHA -> LAB status | Native clinical→release→archive→LAB, browser Admin settings, root scope/no historical, local SHA tests pass | LOCAL PASS; hospital UNC validation post-install |
| R3 | Archive retry, concurrent claim/restart, offline/permission recovery, no release/HIS mutation, no direct SQL privilege escalation | Native app_rw and worker_rw privilege regression, 5 genuine failures→Admin Retry→Worker recovery, real process kill/restart; Win32 no-replace fallback and concurrency on local NTFS | LOCAL PASS; SMB/ACL hospital validation post-install |
| R4 | Backup / restore / quarantined isolated recovery with FileStore/settings and database integrity | Real pg_dump→pg_restore into a separate synthetic database, migration/user/file assets and FileStore SHA matched | LOCAL PASS: real installed operational backup and quarantined restore verified; restore activation not rehearsed |
| R5 | HIS/CFS status distinguishes written from acknowledgment, preserves PET/OK, RES/OK and external PDF | P6 native PostgreSQL 33/33 PASS, existing P6 contracts 551 PASS, no false HIS ACK, release/outbox snapshots unchanged in clinical/Archive tests | LOCAL PASS for tested flows; installed HIS interface acceptance pending |
| R6 | Admin System Health, Exception Center, PDF access audit, operational KPI and scoped Thai UX | Existing Health/Backup and truthful HIS status retained; new Admin operations page, 3 KPI/audit tests, real Chromium Admin/LAB access PASS | LOCAL PASS for implemented scope |
| R7 | Full typecheck/lint, dependency/security audit, compiled app, approved browser E2E and clinical regression | Unit 515 PASS (4 SKIPPED), permissions 857 PASS, Next 16.4.3 47/47 build PASS earlier, lint/typecheck PASS, native browser/clinical/DR/P6 PASS; standalone no-data/source-scope tests PASS | LOCAL PASS for build/tests/payload and signed manifest; separate dependency/supply-chain review not claimed |
| R8 | True 1.1.1 -> 1.1.2 offline Update EXE, preserving data/config, signed manifest, source guard, rollback/backup, repeat upgrade, isolated Windows rehearsal | Real delivered EXE chain Setup 1.1.0 → Update 1.1.1 → Update 1.1.2, all 13 steps PASS; signed manifest/zero-violation package/EXE SHA verified, rollback guard/verified quarantined restore | LOCAL PASS; real hospital acceptance post-install |

## Historical build-and-test environment blocker — RESOLVED (2026-10-29)
The **previous** Dev MCP Control project registration pointed to the dirty parent project, not the isolated `D:\Claude workspace\NIPT-CBH-PARITY-REMEDIATION\.local\claude-update-112` worktree.
Its allowlisted `run_script` is executed from the parent. Vitest tests can be run with `--root .local/claude-update-112`; regular build and installer cannot be proven to use the worktree's package and 16.4.3 dependency this way.
A direct `build .local/claude-update-112` attempt used parent Next **16.4.0**, and exited 1 with `EPERM unlink` in worktree `.next/build/chunks`. This is **not** a successful production build. Worktree's locked dependency version is 16.4.3 from earlier evidence.
Next necessary setup is a **separate registered Dev MCP project whose root equals the isolated worktree**, with read/write and allowlisted test/typecheck/lint/build scripts. Do NOT change the parent project or relocate the worktree. This project registration does not grant production/deploy permission.
The signed installer builder `tools/win-installer/build-package.ts` explicitly requires `CLEAN_COMMITTED_SOURCE_REQUIRED`; a verified, isolated **local** source commit will therefore be needed at packaging time (no push/deploy).

## Next execution order
1. R2/R3: finish native PostgreSQL and browser tests on migration 160, worker process termination/recovery; resolve security and SMB no-clobber compatibility safely.
2. R4/R5/R6: implement/verify approved operational features and regression. Update this table on evidence, not report prose alone.
3. R7: clean worktree-root tests, Next 16.4.3 production build, complete security/source guard.
4. R8: isolated pre-update backup+restore, actual 1.1.1 -> 1.1.2 Windows EXE rehearsal, package manifest and SHA256, Thai install guide.
5. Post-install only: real hospital UNC and Windows Worker account/ACL/SMB compatibility test; do not touch hospital before explicit authorization.

## Direct worktree checks — 2026-10-29
- REGISTERED — `NIPT-CBH-UPDATE-112` Dev MCP project points exactly to the isolated worktree; correct feature branch verified. **No Git push performed** (the project registration currently exposes gitPush but it is not authorized for this release).
- PASS — `npm run typecheck` exit 0; `npm run lint` exit 0; archive tests `npm test -- tests/unit/archive tests/unit/final-report-archive.test.ts tests/db/archive-schema.test.ts` **26/26 PASS**, exit 0.
- CORRECTED — The worker's recovery Test Connection result is no longer accepted as authorization for a new archive activation (API, UI and server-side guard). Focused regression **9/9 PASS**, and final source typecheck exit 0.
- BUILD BLOCKED — `npm run build` resolved **Next.js 16.4.3** from the correct worktree, but failed with `EPERM: unlink .next/build/chunks/node_modules_20v-8wlfss9m1._.js` (exit 1). This appears to involve a locked local build artifact; no files were deleted and no non-project process was terminated. Do not substitute the earlier 16.4.0 parent build or claim production build PASS. Inspect/close the owning development process before rerunning; preserve unrelated work.
- R8 still not started: no installer, no upgrade rehearsal, no host/NAS access.

- BUILD CACHE FOLLOW-UP — After Owner removed the exact sandbox-owned `.next/build/chunks/node_modules_20v-8wlfss9m1._.js` as Administrator, the next correct-root Next.js 16.4.3 build progressed to the adjacent `.js.map` and failed with the same `EPERM unlink`. This indicates multiple sandbox-owned generated artifacts. The safe fix is a **one-time elevated cleanup of the isolated worktree's `.next` directory only** (no source/data/other worktrees), then rerun direct-root build. No further build success claimed.

- BUILD PASS — After the Owner completed elevated cleanup of the isolated worktree `.next` build artifacts, `npm run build` executed from the exact worktree with **Next.js 16.4.3**, exited **0**, compiled, typechecked, and generated **47/47 static pages**. Five Turbopack dynamic filesystem tracing warnings remain: audit traced production payload to ensure no test files, PHI, secrets or archives enter the package. This is app-build PASS, not installer acceptance. The previous EPERM build-environment blocker is resolved.

## Evidence continuation — Native PostgreSQL & UI — 2026-10-29
- VERIFIED — Native PostgreSQL 17 disposable clusters are started on random **127.0.0.1** ports; the synthetic database and cluster are destroyed after each run. Migration 158–160 included, no production connection. Native archive infrastructure 3/3 PASS and clinical release→new PDF archive→offline 5 attempts→FAILED→APP_ADMIN request→Worker actual probe→ARCHIVED PASS. Clinical/HIS snapshots unchanged.
- VERIFIED — Native PostgreSQL **real child-process hard kill and restart**: after stale claim expiry, independent worker archives original bytes once with exact SHA; no double job/clinical/HIS changes. Windows no-clobber fallback uses Win32 MoveFileExW without REPLACE and same-directory promotion after hardlink ENOTSUP; local race and collision/no-overwrite tests PASS. **Real SMB support remains hospital-only post-install acceptance**.
- VERIFIED — Real Chromium on temporary standalone Next.js 16.4.3 + disposable PostgreSQL, with Next Web connecting via **app_rw-inheriting login** (not owner) and Worker restricted: Admin Test/Enable/Disable and operations KPI/PDF Audit page PASS, LAB Settings 403 and hidden NAS path PASS. No credential/source material sent remotely.
- VERIFIED — P6 native sandbox 33/33 PASS, including PDF/RES/OK retries, restart and no false receiver ACK. HIS/CFS production share not contacted.
- VERIFIED — Real synthetic PostgreSQL backup/restore with pg_dump→pg_restore into new database, source/restored FileStore SHA-256 match, archive schema, user and file asset metadata match. This does NOT stand in for encrypted installation-owned DR receipt.
- VERIFIED — Source baseline migration 157 identical bytes to v1.1.1 `c237da44...`; only 158–160 new migrations, historical backfill excluded. Build standalone scan found no disallowed data, env/secret, .local, PHI/file fixtures in emitted server tree.
- VERIFIED — Re-run after changes: Unit 104 files, **515 PASS / 4 SKIPPED**, Permissions **857 PASS**, source-scope 2/2 and standalone guard 1/1, and Typecheck/Lint exit 0. App build must be rerun after final code freeze. These are local tests, not upgrade EXE.
- PREPARED — Thai Owner install guide and exact v1.1.2 package/rehearsal npm script entries; **not executed**. Dev MCP Control allowedScripts currently only `typecheck, lint, test, build`, so calling `release:update:112` / `release:rehearsal:112` requires explicit project allowlisting (do not bypass it).
- PENDING — Operational encrypted Backup/DR receipt, actual v1.1.1→v1.1.2 Windows Update EXE rehearsal, signed package/payload scan, and final EXE SHA256. **No EXE built, no push/deployment/hospital access**.

## Final local Windows release candidate acceptance — 2026-10-29
- **13/13 steps PASS**, `passed:true`, evidence: `.local/p8-win/evidence/update-112-real-chain-rehearsal.json`, format `NIPT_UPDATE_112_CHAIN_REHEARSAL_V1`, tag `updsh5nza`. Real Windows **Setup 1.1.0 → Update 1.1.1 → Update 1.1.2**, using exactly the already-delivered EXEs.
- Update 1.1.2 U6b PASS: source `c237da44...` → `d914a0a8...`; migration ledger contains 157–160; current settings, account count/password hashes, PET/RES marker SHA, HIS paths/database/ports preserved; pre-update backup count increased to 3 and installed health PASS.
- Operational DR U7 PASS: rollback without matching DB restore refused (`ROLLBACK_REQUIRES_DATABASE_RESTORE`); the engine's verified backup restored to **quarantined** isolated database, with `restoreVerified:true`, `quarantined:true`. A restore **activation** into live service was not rehearsed.
- Tamper U7b PASS `SIGNATURE_INVALID`, live installation unchanged/healthy; U8 repeat Update 1.1.2 PASS with no changes; U9 test installation uninstalled; U10 direct 1.1.0→1.1.2 refused with `UPGRADE_BASE_REVISION_MISMATCH`, process exit 2, 1.1.0 unchanged/healthy.
- Signed-manifest and payload scan checked: 21,583 package files, zero policy violations, correct production/update-only profile, Ed25519 verified. EXE SHA-256 independently verified as `9533eb2695f50625e5a010f96f7dd9eb298bfcfddadc1d5fa3a521784c842a13` (131,911,049 bytes). EXE is **NOT Authenticode signed** (Windows SmartScreen may warn).
- EXE folder: `.local/p8-win/setup-d914a0a/` containing `NIPT-CBH-Update-1.1.2.exe`, `SHA256SUMS`, Build Record and delivery status. Test root removed and HKCU NIPT-CBH registry entry absent after rehearsal; no project-owned installer process remains.
- **Local Windows release gates satisfied for a controlled owner installation/UAT**, subject to Owner authorization. **NOT clinical go-live approval**: hospital server/real HIS, real SMB UNC ACL/Worker identity, real reboot/Office, restored-backup activation and clinical operational acceptance still require on-site checks. No hospital server touched, no push/deploy.
