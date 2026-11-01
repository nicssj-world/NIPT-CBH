# Dual-environment release checklist

Status of Staging readiness on the dedicated NIPT-CBH server as of 2026-11-01. Every status below is backed by something
executed on this host or in GitHub Actions, or names what blocks it.

- **PASS**: executed, with the evidence named.
- **PARTIAL**: implemented and partly executed; the rest is listed.
- **BLOCKED**: cannot run yet; the blocker and the party responsible are named.

Branch `feat/dual-environment-deploy` (draft PR #13). Basis: `main` @ `1ad1f340` (v1.1.2). v1.1.3 and Parity are not
included. Production has not been installed or touched.

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
| Staging installation | **BLOCKED (owner)** | the engine and `build-package` both refuse to run without the hash-pinned Combined Master; not bypassed |
| Production | **not started** | by design |

## Remaining blockers and owners

1. **Owner:** attach `NIPT-CBH-HOME-BACKUP` (Combined Master, Singleton/Twin DOCX, task3 sources, lab-owner evidence).
   Then: copy the master to `C:\NIPT-CBH\assets\approved-master.xlsx`, run `preflight.ps1`, `deploy-staging.ps1`,
   `npm run test:owner-assets`, and `office-check` with `--report-master` / `--excel-workbook`.
2. **Owner/IT, elevated prompt:** after the Staging install, `provision-identities.ps1 -Environment staging`, then
   `test-isolation.ps1` until it reports PASS.
3. **Owner:** real APP_ADMIN and CLINICAL_APPROVER identities in `production.json` (Production only).
4. **Hospital IT:** a DNS A record for `nipt-cbh`; remove the hotspot route from the server; set the hospital network
   category to Domain/Private; a trusted certificate for `nipt-cbh`; confirm the KMS host and the default printer.
5. **Owner/IT:** the unrelated PostgreSQL service on `0.0.0.0:5433` is still exposed on all interfaces (not changed here).
6. **Owner:** the repository is public; make it private before committing any internal deployment configuration.
