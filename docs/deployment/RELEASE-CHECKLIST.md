# Dual-environment release checklist

Status of Staging readiness on the dedicated NIPT-CBH server as of 2026-11-01. Every status below is backed by something
executed on this host or in GitHub Actions, or names what blocks it.

- **PASS**: executed, with the evidence named.
- **PARTIAL**: implemented and partly executed; the rest is listed.
- **BLOCKED**: cannot run yet; the blocker and the party responsible are named.

Branch `feat/dual-environment-deploy` (draft PR #13). Basis: `main` @ `1ad1f340` (v1.1.2). v1.1.3 and Parity are not
included. Production has not been installed or touched.

## Production installation (2026-11-01, commit `a45797f`)

| Item | Status | Evidence |
|---|---|---|
| Release identity | **PASS** | `1.1.2-d20261101141135.a45797f`, commit `a45797fbe038816f3f4b56ca21348e5c7ccb0e78` on `origin/main` (PR #13 merged 14:34 UTC) |
| Staging evidence for the exact commit | **PASS** | `history\staging\verified\a45797f…json`: synthetic workflow passed, payload digest `c122a155…`; isolation 0 failed (3 need Production) |
| Production gate | **PASS** | 90 migrations, all rehearsed on Staging; approver and change reference recorded; typed confirmation |
| Install | **PASS** | `C:\NIPT-CBH\production`, status `INSTALLED_NOT_ACCEPTED` (not clinically accepted); private PostgreSQL 127.0.0.1:55432 |
| Single APP_ADMIN | **PASS** | one account `admin` (one-time password, change at first sign-in); `POST /api/auth/login` over `https://192.168.72.194` → 200 with session |
| Health | **PASS** | `ok=true, failed=[]`: supervisor (service identity), PostgreSQL, worker heartbeat, web, renderer, HTTPS, migrations, audit chain, roles, Excel bridge |
| Service identity | **PASS** | services run as `nipt-prd-svc`, startup task at system startup; root ACL without Users/Everyone; Staging identity denied |
| LAN / HTTPS | **PASS (local)** | HTTPS bound to 192.168.72.194:443 only; firewall inbound 443 from 192.168.0.0/16, Private profile (Ethernet Private, Wi-Fi Public). Self-signed certificate with the IP in its SAN: browsers warn until hospital IT issues a trusted one. Access from another LAN workstation: **pending (owner)** |
| NAS backup | **PASS** | `\\<nas>\…\NIPT-CBH-system-backup`: credential only in the service identity's Credential Manager; write/read/remove as the service identity; daily 02:00, keep 30, as the service identity without logon; 2 backups, `CHECKSUM_VERIFIED` |
| Restore | **PASS** | restore of the NAS backup by the service identity into a new database and folder: `restoreVerified=true`, 173 tables, 2 files (both removed afterwards) |
| Windows restart recovery | **PENDING** | controlled restart (also activates the 16–32 GB pagefile), then verify Production starts without logon |
| Excel bridge | **PASS (interactive)** | runs in the signed-in owner session; Task List PDFs need that session; no unattended 24/7 Excel claim |
| Clinical Go-Live / HIS | **NOT AUTHORIZED** | HIS/NAS clinical processing not enabled |
| Historical migration | **NOT STARTED** | |

Defects found and fixed during the installation (none in the clinical release payload): PowerShell 5.1 `Get-Content` strings
exploded the gate payload (6.7 GB, `9e0f715`); the HTTPS health probe ignored the bound address (`c4bac51`); dr-drill refused
in an operator session by design, so restore verification rides on the service identity's scheduled backup (`eaea212`). The
installed engine (`admin\nipt-admin.mjs`) carries these two engine fixes; the original is kept beside it and the change is
logged in `history\production\engine-patches.log`.

## Single APP_ADMIN + Reported By / Approved By (owner decision 2026-11-01)

Production starts with **one** application account, APP_ADMIN (`production.json` `bootstrap.adminUser`/`adminName`); the
former mandatory CLINICAL_APPROVER bootstrap account is removed from the gate, module, engine, bootstrap and installer, and a
definition that still names one is refused (`PRODUCTION_SINGLE_ADMIN_BOOTSTRAP_ONLY` / `SINGLE_ADMIN_BOOTSTRAP_ONLY`).

| Scenario | Status | Evidence |
|---|---|---|
| 1. Install creates only one APP_ADMIN | **PASS (tests)** | `tests/db/admin-upgrade.test.ts` (one account, role APP_ADMIN, must change password, second identity refused, empty-only); `tests/deploy/*` (gate + install arguments carry no `--checker-*`) |
| 2. APP_ADMIN reaches every module | **PASS (tests)** | `packages/security/policy.ts`: every matrix action except patient signing, historical send/promotion, the hard HIS production switch and redraw-after-release; `tests/permissions/*` (879 cases). Database guards: migration `161_app_admin_operator_authority.sql` (11 acting-user predicates, applied cleanly to a fresh database) |
| 3. No CLINICAL_APPROVER bootstrap account | **PASS (tests)** | `tests/db/single-admin-report-personnel.test.ts` |
| 4-6. Both personnel selected in one session; stored separately from the operator | **PASS (tests)** | same file: `signerAuthority` for Reported By and Approved By in one principal, basis `STANDING_DELEGATION`, `operatorId` = administrator; `internal_report.operator_id` / `reported_by` / `approved_by` / `*_authority` (native case in `owner-lab-054-signers-native.test.ts`) |
| 7. Existing users, roles and records | **PASS (design)** | no schema or data change; migration 161 only re-creates guard functions; historical approval rows untouched |
| 8. PDF shows both personnel and verified signatures | see native run below | `owner-lab-054-signers-native.test.ts` "single APP_ADMIN" case |
| 9. A name alone is not evidence | **PASS (tests)** | unverified profile → `SIGNER_PROFILE_NOT_VERIFIED`; no delegation → listed not usable, `SIGNATURE_DELEGATION_REQUIRED`, nothing generated; the administrator itself is never an eligible signer |
| 10. Safeguards and release gates | **PASS (tests)** | self-approval denied for the administrator (maker-checker), certification still needs operational mode, clinical settings still need a second person to approve |

Defect found and fixed while testing: a delegation could only be granted to lab staff, so no one could authorise the APP_ADMIN
to apply their signature (`DELEGATE_NOT_ELIGIBLE`). An enabled APP_ADMIN may now receive a delegation (operator only; it never
becomes a signer).

Operational consequence: rules that need two different people still do. A clinical setting (e.g. the report interpretation
approval) must be proposed by one person and approved by another; with the roles as they are, a LAB_CERTIFIER proposes and the
APP_ADMIN approves and activates. So at least one more user (for example the LAB_CERTIFIER who is Approved By) must exist before
reports can be finalised. Each signer signs in once to submit their profile and grant the delegation.

## Production First assessment (2026-11-01, owner directive)

**Production is not installed.** The owner authorised the installation once the mandatory release checks pass, and they do
not pass yet. Each blocker below is a gate, an owner decision or an IT/elevation action. None was bypassed.

| Item | Status | Evidence / required action |
|---|---|---|
| Production installed | **BLOCKED** | `deploy-production.ps1` would refuse at its gate (below); not attempted, nothing created under `C:\NIPT-CBH\production` |
| Release SHA verification | **BLOCKED** | no commit has a **passed** Staging workflow UAT (`history\staging\verified\*`: `2ba5b82`, `a7adc40`, `260e572` stopped at Pooling before the fonts existed; `6d5b020` has no UAT). Candidate `dda47b5`: `C:\NIPT-CBH\deploy\history\elevated-staging-readiness.ps1 -Candidate <sha>`, run from an elevated prompt, provisions the Staging identity and egress block, deploys the candidate, runs the full journey and the isolation test, and stops Staging. The UAC request for it was declined |
| Candidate on the release branch | **BLOCKED (owner)** | the gate requires the commit on `origin/main`. PR #13 is a Draft and must be reviewed and merged by the owner (or the owner must change `releaseBranch` in the live `production.json` explicitly) |
| Automated checks for the exact commit | **BLOCKED (owner decision)** | CI passes deploy contracts, typecheck, lint, `npm test`, audit, build and after-build tests. The Playwright step still has the pre-existing failures: 2 are verified spec drift from owner-approved UI changes (`5d4e45d`, `258d83c`); the rest need per-test triage (see "Playwright review"). Owner: fix or explicitly accept before promotion |
| Bootstrap identity | **PASS (owner, 2026-11-01)** | one APP_ADMIN, named by the owner, set in the live `production.json` (not in Git); no second bootstrap account (owner decision) |
| Clinical assets | **PASS** | Combined Master `4c5300f9…`, Singleton `a56be6e4…`, Twin `0f731321…`, ANC request/consent: all match their repository pins in `C:\NIPT-CBH\assets` |
| Fonts / Pooling one-page PDF | **PASS** | SimSun (system, Windows optional feature) and TH Sarabun New are installed. `office-check --excel-workbook` with the approved master: all six sheets meet the page contract, **Pooling Table 1 page A4**, 149 formulas; master hash unchanged. TH Sarabun New is installed for the `Admin` user only, which is what the Excel bridge account uses; IT should install it for all users |
| Word PDF | **PASS** | approved Singleton master filled with synthetic values and two signers → 1 page, signatures embedded |
| Excel bridge | **PASS on Staging**, PENDING on Production | 12 exports through the installed Staging bridge. It runs in the **signed-in owner session**: Task List PDFs need that Windows user signed in. 24/7 unattended Excel is not supported and is not claimed |
| Service identity, ACL, firewall | **BLOCKED (elevation)** | `provision-identities.ps1` needs an elevated prompt. A UAC prompt for the Staging run was raised on the console on 2026-11-01 at 15:20 and was **declined** ("The operation was canceled by the user"). It was not repeated. Production needs the same elevated step after its install |
| Windows startup / crash recovery | **PENDING** | engine task + supervisor restart (bounded backoff) are implemented; startup at boot under the Production identity is set by `provision-identities.ps1` (elevated); a reboot test needs the installed Production |
| Backup destination | **BLOCKED (IT)** | **C: and D: are partitions of the same NVMe disk (Disk 0)**, so D: is not separate storage (this corrects the earlier note). E: (WD Elements, the owner's backup) and F: (SanDisk) are removable USB disks. IT must provide a hospital backup share or a dedicated internal disk; then `nipt.cmd set-backup-root --path <folder>` and `schedule-backup` |
| HTTPS / LAN access | **BLOCKED (hospital IT)** | the hospital DNS server (192.168.81.222 per the adapter configuration) did not answer for `nipt-cbh`; both adapters are profile **Public**, so the HTTPS rule (Domain/Private) would not admit clients; a phone-hotspot adapter with its own default gateway is active; a trusted certificate for `nipt-cbh` is needed |
| Memory | **BLOCKED (IT)** | commit limit 18.9–19.3 GB, of which desktop applications use 10 GB or more; a Staging database process was killed at the limit. Fixed pagefile or more RAM before clinical use |
| Staging independence | **PASS (Staging side)** | Staging stopped: 0 Staging processes, both tasks Disabled, about 1 GB commit released; Production root untouched; `postgresql-x64-17` unchanged. The cross-environment runtime check is PENDING until Production exists |
| Clinical Go-Live | **NOT AUTHORIZED** | |
| Historical migration | **NOT STARTED** | out of scope by owner directive |

### On-demand Staging lifecycle (executed)

| Test | Result |
|---|---|
| Stop a running Staging | **PASS**: 23 → 0 processes in 14 s, 561 MB private released, commit 18.64 → 17.66 GB; both tasks Disabled; 1 queued job kept in the database for the next start |
| Repeated stop | **PASS**: idempotent, exit 0 |
| Start without isolation | **PASS (refused)**: `STAGING_ISOLATION_INCOMPLETE: SERVICE_IDENTITY, EGRESS_FIREWALL_RULE`; nothing started |
| Deploy / reset on a stopped Staging | **PASS (refused)**: `STAGING_STOPPED`; nothing started |
| Status | **PASS**: `STOPPED (intentional)` with intent, memory, queue, isolation and UAT; exit 0 |
| Data persistence across stop/start | **PENDING**: before the stop: 45 cases, 46 rounds, 1,556 audit-chain rows, 6 users, 89 migrations, database OID 34862, 60 files (69 MB) (`history\staging\fingerprint-before-stop.txt`); comparison after the next start |
| Start, repeated start, reboot stays stopped | **PENDING**: start needs the elevated provisioning; reboot not performed (owner authorisation needed for a server restart); tasks are Disabled, so no trigger can fire |
| Workflow UAT can be switched off | **PASS (cannot)**: `requireStagingJourney:false` is refused; a stopped Staging does not invalidate recorded evidence (tests) |

### Playwright review (partial; deferred by the Production-first directive)

Most strings the failing specs look for still exist in the v1.1.2 source, so most failures are not removed UI. Verified so far:
- `foundation` responsive/Settings (4 tests): `settings.read` was narrowed to APP_ADMIN in `5d4e45d` (2026-10-23, locked LAB
  UAT remediation), after the spec (2026-10-21) → spec drift.
- `p7` CSV help text was reworded in `5d4e45d` with the same numbers → spec drift.
- `p5` release-suspended notice was retired in `258d83c` (LAB owner UAT closure) → spec drift.
- Draft corrections exist but were **not committed**: a local rerun still failed 5 of the rewritten foundation checks and one
  p5 test (`same file name with different content`, disabled checkbox), so they need more work. Patch kept outside the
  repository. The other groups (p2, p4, task1, timeouts) have not been triaged yet.

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
