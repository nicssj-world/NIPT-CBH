# Dual-environment release checklist

Status of Staging readiness on the dedicated NIPT-CBH server as of 2026-11-01. Every status below is backed by something
executed on this host or in GitHub Actions, or names what blocks it.

- **PASS**: executed, with the evidence named.
- **PARTIAL**: implemented and partly executed; the rest is listed.
- **BLOCKED**: cannot run yet; the blocker and the party responsible are named.

Branch `feat/dual-environment-deploy` (draft PR #13). Basis: `main` @ `1ad1f340` (v1.1.2). v1.1.3 and Parity are not
included. Production has not been installed or touched.

## Staging installation round (2026-11-01, backup `E:\NIPT-CBH-HOME-BACKUP` attached)

**Verdict: Staging is installed, healthy and isolated at the application layer. It is NOT ready**: the workflow UAT stops
at Pooling (missing fonts), and the egress firewall rule and service identity need an elevated prompt.

| Item | Status | Evidence |
|---|---|---|
| Combined Excel Master | **PASS** | `…PARITY-REMEDIATION\.local\claude-update-112\.local\lab-owner-evidence\lab-combined-master.xlsx`, 10,679,212 bytes, SHA-256 `4c5300f9…c7f1` = pin. It has two identical copies in `task3-readygen\.local\approved\master.xlsx` and `codex-migration-20261026\.local\lab-owner-evidence\`. Copied to `C:\NIPT-CBH\assets\approved-master.xlsx` and re-verified there |
| Singleton DOCX / Twin DOCX | **PASS** | `…claude-update-112\.local\task3-sources\singleton.docx` (928,411 B, `a56be6e4…` = pin) and `twin.docx` (925,181 B, `0f731321…` = pin). Copied to `C:\NIPT-CBH\assets\templates\`, to be registered through the in-app template registry (upload → validate → second-person approve → activate). The installer does not consume them |
| HALOS task / NIFTY / Pooling CSV templates | **not copied** | `…\.local\approved\halos-task.xlsx`, `nifty.xlsx`, `pooling.csv` exist, but nothing in the repository pins them, and only the developer UAT tools read them (`tools/task3-uat`, `tests/helpers/task3.ts`). The installed services do not |
| ANC PDFs | **PASS** | unchanged; still match their pins |
| Asset ACLs | **PASS** | `C:\NIPT-CBH\assets\**`: Administrators, SYSTEM, owner only. The backup was only read |
| Staging preflight | **PASS** | 16 PASS, 4 WARN, **0 BLOCKED**. WARNs: no service identity yet, not elevated, the unrelated 0.0.0.0:5433 PostgreSQL, and repository visibility unknown (the preflight bug that reported "private" on a rate-limited 403 is fixed) |
| Staging install (`deploy-staging.ps1`, full validation, `2ba5b82`) | **PASS** | all validation steps passed, then the signed package and the engine install: private PostgreSQL 17 cluster, 89 migrations, 6 UAT accounts, startup and Excel-bridge tasks, first verified backup |
| Upgrade (`a7adc40`, `260e572`) | **PASS** | verified pre-upgrade backup, release switch, health; the previous release is kept. An earlier attempt was **refused safely** (`QUEUE_NOT_QUIESCENT`, nothing changed) because a worker crash had left one job active (see "Host memory") |
| Compatible rollback (engine, on Staging) | **PASS** | `nipt-admin rollback`: `260e572 → a7adc40` in 31 s, schema gate passed (89 applied, compatible), HEALTHY. Rolled forward again afterwards |
| Health check | **PASS** | `health-check.ps1 -Environment staging`: HEALTHY; stamp, config and database marker = staging; backup CHECKSUM_VERIFIED; listeners 127.0.0.1 only (55442, 3010, 3011, 8443) |
| Live web service under the boundary | **PASS** | `GET /api/admin/deployment` as APP_ADMIN on the installed Staging: environment `staging`, release, commit, 89 migrations, checksums match |
| Live isolation: Settings cannot point Staging at HIS/NAS/Production | **PASS** | an APP_ADMIN `POST /api/settings/his-paths` on the running service was **refused (400)** for a HIS UNC, a NAS UNC by IP, a Production folder, a mapped drive, the loopback `C$` share, and two **existing** folders outside Staging (`C:\Users\Public`, `C:\NIPT-CBH\deploy`). The positive control (Staging's own folder) was **accepted (200)**, then restored |
| Installed-release boundary probe (`test-isolation.ps1`) | **PASS** | 10/10 refused (Production files/outbound, HIS/NAS UNC, outside folder, remote archive, `C$` admin share, mapped drive, `\\?\UNC`, Production database port); own folder allowed |
| `test-isolation.ps1` verdict | **INCOMPLETE (security blocker)** | exit 2: no egress firewall rule and no dedicated identity (both need an elevated prompt). The Production-pair checks need Production, which is intentionally not installed |
| Excel bridge end to end | **PASS** | 12 Task List exports through the installed bridge task (owner's interactive session, `data\excel-spool`): all COMPLETE, no Office process left, spool empty |
| Word PDF with the approved Singleton master | **PASS** | `office-check --report-master`: real master filled with synthetic values and two signers → 1 page, 7 images, valid PDF |
| Excel PDF with the approved Combined Master | **BLOCKED (IT: fonts)** | `TASK_PDF_ONE_PAGE_A4_REQUIRED`. Sheets 1–4 and 6 meet the page contract; **Pooling Table exports as 2 pages**. The workbook uses **宋体 / SimSun** (its default font, 7,358 cells, which sets every row height) and **TH Sarabun New** (330 cells), and neither is installed here. With substitute fonts the rows grow and the fixed 66% zoom spills onto a second page. Nothing in the master or the one-page check was changed. Install both fonts for all users: SimSun is the Windows optional feature "Chinese (Simplified) Supplemental Fonts" (elevated: `Add-WindowsCapability -Online -Name Language.Fonts.Hans~~~und-HANS~0.0.1.0`); TH Sarabun New is the Thai government national font package. Then rerun `office-check --excel-workbook` and `reset-staging.ps1 -Seed`. The cause will be confirmed by that rerun |
| Synthetic workflow UAT (`reset-staging.ps1 -Seed`) | **PARTIAL** | guarded reset passed. The journey then passed: HTTPS login (secure cookies), **45** registrations + 45 HIS PET receipts by the worker + P2 clinical approvals + specimen gates, S2 resampling (new PET, new approval), label print/reprint audit, native pre-work execution + second-person QC1. It **stops at pool issuance** with `TASK_PDF_ONE_PAGE_A4_REQUIRED`, which is the font blocker above; the application correctly refuses a non-conforming document. Two stale journey inputs were fixed on the way (12-digit LNs → the 10-digit operational LN contract; a synthetic, runtime-check-digit citizen ID starting with 0 for the request contract); no application rule was changed |
| Host memory | **BLOCKED (IT)** | 15.7 GB RAM with a system-managed 2.3 GB pagefile gives an 18 GB commit limit. When a build, a browser test run and Staging overlapped, Windows killed a Staging PostgreSQL backend with `0xC000012D STATUS_COMMITMENT_LIMIT`. PostgreSQL recovered on its own; the worker crashed and left one job active, which correctly blocked the next upgrade's backup until it expired. Increase the pagefile (or the RAM) before Production; avoid running builds on the server while it is in clinical use |

## Toolchain (Phase 2)

| Item | Status | Evidence |
|---|---|---|
| Node.js 24 + npm | **PASS** | v24.22.2 / npm 11.19.1 in `C:\NIPT-CBH\toolchain\node`. The zip's SHA-256 matches nodejs.org `SHASUMS256.txt` |
| PowerShell 7 | **PASS** | 7.6.9 in `C:\NIPT-CBH\toolchain\pwsh7`. The zip's SHA-256 matches both the release's `hashes.sha256` and GitHub's asset digest; `pwsh.exe` Authenticode: Valid, Microsoft Corporation |
| Git / Git Credential Manager | **PASS** | git 2.56.0.windows.4, GCM 2.9.1; pushes to the PR used the stored login |
| Chromium | **PASS** | `chromium_headless_shell-1248` via `npx playwright install chromium` into `C:\NIPT-CBH\toolchain\ms-playwright` |
| PostgreSQL 17 command-line tools | **PASS** | 17.11 binaries in `C:\Program Files\PostgreSQL\17` (used as binaries only; the `postgresql-x64-17` service on 5433 was not touched) |
| `npm ci` | **PASS** | 441 packages from the lockfile |

## Build and tests (Phase 2/3)

| Check | Local (CI-equivalent PostgreSQL 17 on port 56500) | GitHub Actions |
|---|---|---|
| `node --test tests/deploy/*.node.mjs` | **PASS** 36/36 | **PASS** from `180cee3` (it failed on `c10920c` and `934b2c1`: the boundary root was resolved with native path rules, which on Linux makes a Windows-shaped root relative; fixed and reproduced with `path.posix` emulation) |
| `npm run typecheck` | **PASS** | **PASS** |
| `npm run lint` | **PASS** | **PASS** |
| `npm test` | see below | see PR #13 |
| `npm run build` | **PASS** (standalone produced; 5 Turbopack warnings, all in files this PR does not change) | see PR #13 |
| `npm run test:after-build` | **PASS** 2/2 | new CI step after the build |
| `npm run guard` | **PASS** (1437 files) | **PASS** |
| Pester `tests/deploy/NiptDeploy.Tests.ps1` | **PASS** 6/6 | not run by CI (Windows only) |

Before this round, `npm test` locally gave 2560 passed, **39 failed**, 45 skipped. On `main` it has failed in CI since v1.1.2, and
on this PR it was cancelled at the job's 25-minute limit. The causes, each from the actual error:
- **25 files** read the owner's private clinical files (`.local\lab-owner-evidence`, `.local\task3-sources`, the owner's
  `C:\Users\User\Downloads\…`). These files never enter Git, so the tests cannot run on CI. They are now listed in
  `tests/test-groups.json` and run with `npm run test:owner-assets`, which **fails** (not skips) on a missing file.
- **2 files** need `.next/standalone`, but CI builds after `npm test`. They now run in a new CI step after the build.
- **`archive-admin-browser-native`** had a real fixture defect. It re-seeded the already-seeded shared test database with a
  fresh lookup key and password, which caused an Idempotency conflict and then a failed sign-in. It also logged in with a
  passwordless role, which scram-sha-256 refuses. It now uses the suite's key and password and a per-run role password, and
  passed twice on the same database.
- The job timeout was raised from 25 to 50 minutes, because `npm test` alone takes about 20 minutes.

With those changes, local `npm test` gave **2565 passed, 0 failed**, 45 skipped. The 45 were skipped before as well. The next CI
run (`c6c6b05`) showed three Linux-only failures, each now fixed:
- **`win-installer-lib`:** `assertSafeRoot` used native path rules, so on Linux `C:\` was not a drive root. It now uses Windows
  rules explicitly, which is identical on Windows, where the installer runs.
- **`update-112-source-scope`:** this test compares migration 157 with its bytes at historical commit `c237da4`, but CI checked
  out only one commit. CI now uses `fetch-depth: 0`.
- **`archive-backup-restore-native`:** this already failed on `main`. It needs Windows `pg_dump.exe`/`pg_restore.exe`, so it now
  runs as `npm run test:windows-native`, which **passes** on this server and fails rather than skips when the binaries are missing.

`tests/unit/test-groups.test.ts` fails if a group lists a missing file or the groups overlap.

## Microsoft Office (Phase 5)

| Item | Status | Evidence |
|---|---|---|
| Office activation | **PASS** | Office Standard 2019 Volume (x86), `OSPP.VBS /dstatus`: LICENSED, KMS client, 177 days remaining. Hospital IT should confirm the configured KMS host is theirs |
| First-run state (Word) | **PASS** | `FirstRun=0`, `ShownFirstRunOptin=1`, no Word resiliency (disabled-item) entries |
| Word PDF through the production renderer | **PASS** | `office-check.ts` → `word_synthetic_signers`: 1 page, 4 signature images, valid PDF, in 3–5 s; no Word process left |
| Excel PDF through the production export script | **PASS** | `native-export.ps1` on a synthetic 6-sheet workbook: 6 valid PDFs in 6 s; its own Excel instance recorded and exited; printer paper set to A4 during export and restored |
| Office instance cleanup | **PASS** | each export records the PID of the instance it starts and stops only that one if it does not exit; after a script timeout the caller stops exactly that recorded instance; `tests/unit/office-instance.test.ts` shows a non-Office PID is never stopped |
| Approved masters through Word/Excel (`office-check --report-master/--excel-workbook`) | **BLOCKED** | Singleton DOCX and Combined Master missing (owner) |
| Excel bridge end to end (Staging spool, interactive user task) | **BLOCKED** | needs an installed Staging |
| Default printer | **PARTIAL** | the current user's default printer is "Adobe PDF" (Acrobat XI). The export depends on the default printer's driver for A4. Hospital IT should confirm a supported, licensed default printer for the bridge account |

**Correction:** the previous round reported "Word hangs". That was caused by my own diagnostic probe: a failed PowerShell
`[ref]` call left a hidden Word instance open with an unsaved document, and the next probe attached to it. Word itself
works; see the PASS rows above.

The supported execution model is unchanged. Excel/Word run only in the owner's **interactive** session, through the Excel
bridge task (`excelMode: bridge`), never in session 0. Automatic logon is not configured and no Windows password is stored.

## Isolation (Phase 6)

`test-isolation.ps1` now exits 0 only when every check ran and passed, 2 (INCOMPLETE) when any check could not run, and 1
on a failure. A missing firewall rule or service identity is reported as a security blocker.

| Requirement | Status | Evidence / remaining |
|---|---|---|
| Staging credentials refused by Production PostgreSQL; separate clusters; loopback listeners; no shared secret | **PARTIAL** | rehearsal on two real PostgreSQL 17 clusters: 12 PASS (migrator/web/worker refused with `password authentication failed`, positive controls connect). Repeat on the installed environments |
| Staging cannot write Production folders, HIS/NAS paths, mapped drives, aliases | **PASS** (application layer) | 12/12 boundary tests: UNC by name or IP, `\\?\UNC\`, mapped/`subst` drives, real **junctions** into Production (resolved by Windows), a root that is an alias, loopback admin shares (`C$`, `ADMIN$`), any archive share not named `nipt-staging-*` |
| Staging fails closed when its identity/configuration is missing | **PASS** | missing stamp → service exits; stamp/config mismatch → supervisor refuses; boundary half-configured → refused |
| Staging outbound firewall block | **BLOCKED (security)** | `provision-identities.ps1 -Environment staging` needs an elevated prompt (owner / IT) |
| Dedicated Windows identities and NTFS ACLs | **BLOCKED (security)** | same script, elevated; needs installed roots |
| Staging cannot read Production secrets | **BLOCKED** | ACL deny for `nipt-stg-svc`, applied by the elevated script |
| Reset Staging leaves Production unchanged | **BLOCKED** | `test-isolation.ps1 -IncludeReset` needs both environments installed |

## Configuration and network (Phase 7)

| Item | Status | Evidence / required action |
|---|---|---|
| Separate ports/roots/instances/keys/accounts | **PASS** | gate refuses any shared value (tests); preflight confirms the live definitions |
| Production bootstrap identities | **BLOCKED (owner)** | the template ships empty; Production refuses empty or placeholder names (`PRODUCTION_BOOTSTRAP_IDENTITY_REQUIRED`). Staging is not affected |
| Workflow UAT cannot be bypassed by omission | **PASS** | required unless `requireStagingJourney: false` is set explicitly (tests) |
| DNS for `nipt-cbh` | **BLOCKED (hospital IT)** | the configured hospital DNS server did not answer (timeout); the hotspot DNS has no record. The Wi-Fi address seen earlier was this server answering its own name from its hotspot adapter. Hospital DNS needs an A record `nipt-cbh` → the server's hospital LAN address only |
| Network | **BLOCKED (hospital IT)** | the server is dual-homed: the hospital LAN plus a phone hotspot with its own default gateway. Both are profile **Public**, so the Production HTTPS rule (Domain/Private) would not admit LAN clients |
| Backup destination | **BLOCKED (owner/IT decision)** | by default the engine backs up to `<root>\backups` on **C:**, the same disk as the database and file store. Choose a separate destination (this server has a separate data volume, D: "NIPT-DATA", or a hospital backup share), then run `C:\NIPT-CBH\production\nipt.cmd set-backup-root --path <folder>` and `schedule-backup` after installation. Staging may keep the default |
| Trusted TLS | **BLOCKED (hospital IT)** | needs a certificate for `nipt-cbh` issued or trusted by hospital IT; the self-signed engine certificate is not acceptance |

## Clinical assets (Phase 4)

`NIPT-CBH-HOME-BACKUP` is **not attached**. Only C: and D: exist, and a search of both found none of its folders
(`lab-owner-evidence`, `task3-sources`, `approved`, `forms`, `Parity-Source`, `Migration-Source`). A SHA-256 search of every
workbook (19) and document (16) on both drives found no pinned file.

| Asset | Pinned SHA-256 (repository) | Destination | Status |
|---|---|---|---|
| Combined Excel Master (includes the HALOS / NIFTY / Pooling sheets) | `4c5300f9…c7f1` (`packages/workbook/master-manifest.json`) | `C:\NIPT-CBH\assets\approved-master.xlsx` | **BLOCKED (owner)** |
| Singleton DOCX FM-WI-T-BM-17-07 | `a56be6e4…9117` (`packages/readygen/interpretation.ts`) | application template registry | **BLOCKED (owner)** |
| Twin DOCX FM-WI-T-BM-17-08 | `0f731321…ddd1bf3` (same file) | application template registry | **BLOCKED (owner)** |
| ANC Request PDF (BM17) | `c5b2bfce…511b` (`tools/win-installer/form-assets.mjs`) | `C:\NIPT-CBH\assets\forms\request.pdf` | **PASS**: staged, hash re-verified, administrator-only ACL |
| ANC Consent PDF (BM17) | `dc791bb8…3f0332` (same file) | `C:\NIPT-CBH\assets\forms\consent.pdf` | **PASS**: staged, hash re-verified, administrator-only ACL |
| Forms registry | generated from the pinned hashes at build time (`bundledFormRegistry`) | inside each release | **PASS** (no file to supply) |

The two ANC PDFs came from an earlier build folder on this host, not from the owner's backup. They are byte-identical to the
pinned originals (SHA-256). The owner may replace them from the backup, and preflight re-verifies either way.

## Preflight and Staging installation (Phase 8)

| Item | Status | Evidence |
|---|---|---|
| `preflight.ps1` on this host | **PARTIAL** | 17 PASS, 11 WARN, 2 BLOCKED: Combined Master (blocks Staging), bootstrap identities (Production only) |
| `deploy-staging.ps1` up to the asset gate | **PASS** | it resolved HEAD to `36ee288`, read app version 1.1.2 from that commit, produced release `1.1.2-d20261101040048.36ee288`, created the clean worktree, verified both ANC PDFs, then **stopped before building** with `MASTER_WORKBOOK_MISSING` and the pinned hash, recording the failure in `deploy\history\staging\…\record.json` |
| Build pipeline (the deploy module's own steps, clean worktree `36ee288`) | **PASS** | npm ci 48 s, deploy contracts, typecheck, lint, test:unit, guard: all exit 0; `build-package.ts` test profile with the Staging key: **24,294 files**, runtime included (Node, PostgreSQL, Chromium, PowerShell 7), 89 migrations; `nipt-admin verify-package` with the Staging public key: **signature OK**. This was packaging proof only (master omitted), not installed |
| Signing keys | **PASS** | Staging Ed25519 key created on first use; `deploy\keys\staging\` readable only by Administrators, SYSTEM and the owner |
| Staging installation | **PASS** (superseded) | installed once the backup was attached; see "Staging installation round" above |
| Production | **not started** | by design |

## Remaining blockers and owners

1. **IT, elevated:** install the fonts **SimSun** (Windows optional feature "Chinese (Simplified) Supplemental Fonts") and
   **TH Sarabun New** for all users. Then run `office-check --excel-workbook C:\NIPT-CBH\assets\approved-master.xlsx`
   (expect `excel_master_task_pdf` ok) and `.\deploy\reset-staging.ps1 -Seed` (expect the journey to pass Pooling and
   finish). This blocks the workflow UAT and therefore any Production promotion.
2. **Owner/IT, elevated prompt:** `.\deploy\provision-identities.ps1 -Environment staging` (local identity `nipt-stg-svc`,
   NTFS boundary, supervisor at system startup, Staging egress block), then `.\deploy\test-isolation.ps1` from an elevated
   prompt until its verdict is PASS. Until then the egress rule and identity are open security blockers.
3. **IT:** raise the commit limit (pagefile and/or RAM), see "Host memory".
4. **Owner:** register the verified Singleton/Twin masters in Staging's template registry (upload, validate, second-person
   approve, activate) from `C:\NIPT-CBH\assets\templates\`.
5. **Owner:** 39 of 109 Playwright E2E tests fail on drift between the v1.1.2 UI and older specs (for example the settings
   category navigation "หมวดการตั้งค่า" and empty-state texts no longer rendered after the Settings rework `112abcd`).
   Deciding whether the UI or the spec is correct is a product decision; neither was changed. The list is in the PR.
6. **Owner:** real APP_ADMIN and CLINICAL_APPROVER identities in `production.json` (Production only).
7. **Hospital IT:** a DNS A record for `nipt-cbh`; remove the hotspot route from the server; set the hospital network
   category to Domain/Private; a trusted certificate for `nipt-cbh`; confirm the KMS host and the default printer.
8. **Owner/IT:** the unrelated PostgreSQL service on `0.0.0.0:5433` is still exposed on all interfaces (not changed here).
9. **Owner:** confirm the repository visibility (it was public; the last automatic check could not tell because GitHub
   rate-limited it) and make it private before committing any internal deployment configuration.
