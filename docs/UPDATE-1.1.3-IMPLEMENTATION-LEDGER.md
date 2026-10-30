# NIPT-CBH v1.1.3 — Implementation Ledger

> 2026-10-30: P1/P3/P4/P5/P6 sections below are historical and stale. Current work and independently verified evidence are tracked in `UPDATE-1.1.3-RELEASE-CHECKLIST.md`; none of those sections establishes release readiness. In-flight Dispatched outbox entries now retain their state and remain visible for reconciliation; this does not stop a worker or complete P1.

## Owner locks / baseline
- Owner approved implementation of P0–P6 on 2026-10-29; hospital operational server is **v1.1.2**.
- Isolated branch `feat/update-113-owner-scope` at `D:\Claude workspace\NIPT-CBH-PARITY-REMEDIATION\.local\claude-update-113`, based on clean v1.1.2 final checkout commit `1ad1f340bde071549f004b091de498c10fb5beb8`. Production v1.1.2 EXE source revision `d914a0a8a95a261b3d02f16a4458f986e924ebfa`.
- Parent worktree contains unrelated clinical changes; do not modify or merge without review. Never touch hospital server, push or deploy without separate owner authorization.
- Release only **Update 1.1.2 → 1.1.3** after native PostgreSQL, Windows upgrade rehearsal and owner UAT. EQA historical migration and data changes are not implicit.

## P0 — HIS path validation — LOCAL CODE + FOCUSED TEST PASS
- `packages/settings/direct.ts`: pass exact changed HIS path field names to the share check; other settings remain immutable or separately authorized.
- `packages/settings/his-check.ts`: path-only Save checks only the changed RES/CFS/Backup destinations; default full readiness check remains available. Worker/Windows share identity and permissions are not bypassed; each path gets write/readback/delete probe and safe `pathType` error.
- `src/server/settings-errors.ts`: Thai label for affected Path; no UNC/credentials echoed.
- `tests/unit/his-path-changed-only-113.test.ts`: operational temp directories validate Backup-only save with inaccessible unchanged RES/CFS; full check still rejects RES; mixed changed fields identify CFS; unknown keys fail closed.
- Test result: 15/15 tests (including existing HIS path suite), TS and Lint PASS.
- Remaining: native DB revision/audit + real Admin browser flow/production share probe (not run).

## P1 — Admin Worker Queue Management — READ-ONLY BASELINE IMPLEMENTED; CLEAR ACTIONS PENDING
- Owner wants queue of *every* Worker job type with Retry, Clear Selected, Clear All across Pending, Running, Failed, Completed and Scheduled/Retry.
- Source reconnaissance: distinct `job_outbox` (Pending/Dispatched/Cancelled), `integration_job_receipt` (completed receipts), `pg-boss` worker jobs and `pdf_archive_job`; these are **not** one interchangeable queue. Needs state reconciliation, idempotency, in-flight cancellation protocol, no false HIS ACK and audit before admin Clear All can safely be implemented.
- Clinical/HIS transport state and prior successful deliveries must NEVER be erased by clearing queue; no row deletion.
- IMPLEMENTED: `packages/jobs/admin-center.ts`, admin-only `settings/worker-queue` page + settings nav, read-only redacted SQL for job_outbox with integration receipts and PDF Archive state. Bounded 75 latest jobs; payload and PHI omitted. Unit 2/2, PGlite native-schema DB 1/1 PASS. *Not* yet inclusive of pg-boss internal queue, and no Clear controls enabled; do not claim full P1 accepted.

## P2 — Chrome/Edge Install App (PWA) — LOCAL CODE + FOCUSED TEST PASS
- `src/app/manifest.ts` sets app name/scope, same-origin `/login` start URL, standalone mode, Thai locale and local PNG icon URLs.
- `src/app/pwa-icons/[size]/route.tsx`: locally generated PNG icons at 192 and 512, including maskable entry; no network/PHI.
- `src/app/layout.tsx`: manifest and AppleWebApp metadata.
- **No service worker, offline cache, IndexedDB for PHI, PDF cache or client-side document storage** introduced.
- `tests/unit/pwa-install-113.test.ts`: 3/3 PASS, confirms real PNG bytes/dimensions and manifest.
- Requires trusted HTTPS cert on client and real Chrome/Edge installability acceptance.

## P3 — Patient PET Gate — NOT IMPLEMENTED
- Source assessment: `packages/lab/gate.ts` currently passes BG-01 for round >= 2 `NIPT_LOCAL_RECEIPT`; BG-03 accepts local label+identity without round PET. `packages/lab/core.ts` materializes these facts. `lab_storage` explicitly treats PET as non-precondition. This does NOT enforce the new patient gate.
- Must enforce actual round-specific verified PET in Auto/Manual/Urgent/Replaced/Finalized pathways, server API/DB, and recheck after move/replacement. No bypass through paper consent/LAB_DIRECT.
- **Do not** introduce gate until EQA explicit exception model is integrated; EQA may be PET-less but requires organizer identity and all outbound HIS suppression.

## P4 — EQA — NOT IMPLEMENTED
- Explicit internal EQA classification and organizer proof; no invented PET, no HIS/RES/CFS outbound in any release/repeat/no-call path, while allowing standard report layout and ReadyGen clinical workflow.
- Never render EQA marker on patient-style PDF. Audit/admin internal marker remains.

## P5 — EQA annual & IQC Positive/Negative — NOT IMPLEMENTED
- Actual versioned organizer records/year view, PC/NC only; do not invent thresholds.

## P6 — PET Scan History & Retention — DISPLAY FILTER IMPLEMENTED, RETENTION PENDING
- Source `his_inbound_scan_run` is append-only and protected by immutable trigger in migration 008; automatic scan EVERY 1 minute generates one detailed immutable receipt per cycle.
- `packages/inbound/queue.ts`: history count and pagination exclude **routine successful interval scans 0/0 older than 24h**, while preserving all MANUAL/DEEP scans, failed/partial/backoff and meaningful new/invalid PET scans. `src/app/(protected)/inbound/page.tsx` clarifies displayed count and no physical deletion.
- `tests/db/pet-scan-history-113.test.ts`: native PGlite migration + fixture verifies 4 of 5 rows shown (old 0/0 excluded). PASS.
- **Important: No database retention/compaction implemented yet; old immutable rows remain and database still grows.** Must design approved aggregate/cleanup protecting legal audit, health, backoff and PDF/PET intake evidence. Do not bypass immutable trigger or delete patient files.

## Tooling blocker
- First production `npm run build` on fresh worktree failed **before compilation**: `Could not find Next.js package (next/package.json)`, unexpected Next.js 16.4.0 resolved from another checkout instead of locked 16.4.3. Worktree's local `node_modules` needs an authorized `npm ci` and repeat Build; do not misrepresent as PWA failure.
- `npm run typecheck` and `npm run lint` PASS for initial P0/P2/P6 and P1 read-only code (rerun TS after test fix). P0 15/15, P2 3/3, P6 DB 1/1, P1 Unit 2/2 and DB 1/1 PASS. Permissions matrix 857/857 PASS.
- `npm run test -- tests/unit` reported 511 PASS / 10 FAIL / 9 SKIPPED in new worktree; multiple failures explicitly due missing `node_modules/@fontsource/...` and standalone output; exact remaining failures require rerun after `npm ci`. Do NOT label full suite passed.
- Added explicitly-named project setup script `deps:install:113` = `npm ci --no-audit --no-fund`. User must add it to Dev MCP Control `NIPT-CBH-UPDATE-113` Allowed Scripts before invoking via MCP; tool policy must not be bypassed.

## Remaining release gates
- P0 end-to-end Admin HIS settings with non-regression pretransfer; P1 all job classes including pg-boss, atomic cancellation & audit; P3 hard PET gate; P4 safe EQA exception/no HIS; P5 quality control; P6 true retention strategy.
- Full unit/DB/native PostgreSQL, PWA Browser, packaging/source guard, upgrade 1.1.2→1.1.3 Windows rehearsal with DR, real hospital acceptance.
- NO production EXE built. NO push/deployment, no hospital server contacted.

## Workspace validation and Git checkpoint issue — 2026-10-29 evening
- LOCAL: focused v1.1.3 P0/P1-read/P2/P6-view + existing HIS tests **25/25 PASS**, Permission Matrix **857/857 PASS**, Typecheck PASS, ESLint PASS after correcting the new test.
- NEW Worktree lacks its own complete Next.js 16.4.3 / Thai font packages. Full Unit suite **511 PASS / 10 FAIL / 9 SKIP**, with multiple missing runtime file errors; first Production Build fails prior to compilation. An allowlisted `deps:install:113` task is prepared in `package.json` to run lockfile-exact `npm ci --no-audit --no-fund`, pending explicit Dev MCP Control allowlisting.
- Source files are changed only in `NIPT-CBH-UPDATE-113`; `NIPT-CBH-UPDATE-112` remains frozen and clean.
- LOCAL GIT BLOCKER: Dev MCP Control `git_stage` fails `fatal: unable to write new index file` even with a single file. Read-only diagnostics show actual Git index `D:\Claude workspace\NIPT-CBH\.git\worktrees\claude-update-113\index` exists, no `index.lock`, 38.91 GB free on drive D, index owned by `BUILTIN\Administrators`. This is an index write/ACL issue, **not a source/build error**. No broad ACL reset, takeown, Git index deletion or forced commit attempted. Local Git Commit has **not** been made.
- Do not install on hospital server or issue 1.1.3 Update EXE until all P0–P6 and Windows release gates pass.

## P0 integrated acceptance after dependency installation — 2026-10-29
- `deps:install:113` was allowlisted and executed: `npm ci --no-audit --no-fund` **PASS**, 443 packages, verified Next.js 16.4.3. Initial production `npm run build` **PASS** before later P0 refinements; rerun after changes.
- P0 real Windows filesystem in operational mode + migrated PGlite DB (`tests/db/his-path-operational-113.test.ts`): **5/5 PASS**. The caller uses the actual `saveHisPaths` → `saveSystemSetting` → `checkHisSetting` chain. Backup-only save succeeds while existing RES/CFS are invalid, then RES and CFS separately; active revisions and GET overview persist. Failure returns RES pathType and no new revision, PET inbound with empty day folder is accepted, ReadyGen folder saved, only APP_ADMIN authorized, full outbound check remains intact. Temporary connection-probe bytes are written/read back/deleted on actual OS filesystem.
- P0 API route (real `POST/GET /api/settings/his-paths` module + PGlite with mocked auth/database adapters, **not a live HTTP/browser server**): `tests/db/his-path-api-113.test.ts` **4/4 PASS**. Backup-only returns HTTP 200 and active GET; failed CFS returns HTTP 400 `SHARE_PATH_NOT_FOUND`, `pathType=CFS_PDF` and previous settings unchanged; independent RES/CFS paths both save; wrong role returns 403.
- `packages/settings/his-paths.ts` typed the changedPathFields callback explicitly, preserving the proper third argument all the way from `saveSystemSetting`.
- `packages/results/folder.ts` now verifies a ReadyGen destination is **listable** with `fs.readdir`, not merely that `fs.stat` says the folder exists.
- `packages/settings/his-check.ts` attaches PET pathType to inbound errors; `src/server/settings-errors.ts` supplies clear safe Thai errors for junctions, system paths, access roles, invalid folders, policy errors and unsafe UNC input.
- Integrated P0 regression **34/34 PASS** across six test files: original `tests/db/admin-direct-settings.test.ts`, new DB operational + API route tests, original `tests/unit/his-paths.test.ts`, new changed-only unit test, existing HTTP errors. Full unit suite 522 PASS / 1 FAIL / 9 SKIP after npm ci; remaining `tests/unit/task1-exceptional-highlight.test.ts` fails only because ignored `.local/lab-owner-evidence/lab-combined-master.xlsx` was not copied into the new worktree. Original files must not be falsified or tests suppressed.
- **P0 still needs live native PostgreSQL + Browser Admin actual HTTP and real hospital UNC SMB ACL acceptance** before v1.1.3 release; do not describe these as already tested.

## P0 strengthened proof — 2026-10-29 (final update this session)
- **40/40 P0 regression tests PASS** across `tests/db/admin-direct-settings.test.ts`, `tests/db/his-path-operational-113.test.ts`, `tests/db/his-path-api-113.test.ts`, `tests/unit/his-path-changed-only-113.test.ts`, `tests/unit/his-paths.test.ts`, `tests/unit/p2-http-error.test.ts`.
- Actual HIS Path API module POST/GET tested against an isolated migrated PGlite DB with a **transactional adapter**. Tests cover Backup-only Save (existing RES and CFS inaccessible); independent RES/CFS; invalid PET/CFS/ReadyGen with field-labelled 400, no changes; invalid mixed RES+Backup rejected atomically; cross-setting PET+ReadyGen partial failure transaction rolls back both; admin-only 403.
- Windows service-account share policy enforced in temporary real filesystem: positive probe performs write/readback/delete with real current Windows identity; wrong-account configured policy returns stable `SHARE_SERVICE_ACCOUNT_MISMATCH` and refuses Save. Full readiness validation of all outbound paths remains callable and verified.
- Externally supplied ReadyGen folder must be **readable**, not merely an existing directory.
- `npm ci` PASS; production `npm run build` PASS twice at Next.js 16.4.3; source Typecheck/Lint PASS. Not a certificate that the hospital's actual UNC share is accessible: requires authorized acceptance of its actual SMB/network permissions during controlled installation only.
- Git stage still blocked due worktree index permission; all source/commit changes are intact, no local commit/push performed.
