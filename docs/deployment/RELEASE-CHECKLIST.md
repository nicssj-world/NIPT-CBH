# Dual-environment release checklist

Status of the Staging/Production direct-deployment work on the dedicated server, as of 2026-11-01. Each item has a status:

- **PASS**: executed, with the evidence named here.
- **PARTIAL**: the mechanism is implemented and part of it was executed; the rest is listed.
- **BLOCKED**: cannot be executed yet; the blocker is named.

No item is marked PASS from inspection alone.

Basis: branch `feat/dual-environment-deploy` from `main` @ `1ad1f340` (v1.1.2 baseline). v1.1.3 and Parity are not included.

## Evidence executed on this host

| # | Evidence | Result |
|---|---|---|
| E1 | `node --test tests/deploy/*.node.mjs`: environment boundary (11), deployment gates (11), existing deploy contracts (13) | 35/35 pass (Node v24.22.1; the host's only Node 24 binary, used as a test interpreter only) |
| E2 | `Invoke-Pester tests/deploy/NiptDeploy.Tests.ps1`: every script parses, argument quoting round-trip through a real process, install arguments per environment | 6/6 pass (Pester 3.4.0) |
| E3 | `node --check` on the changed engine files (`supervisor.mjs`, `nipt-admin.mjs`, `lib.mjs`, `environment-boundary.mjs`, `runtime-env.mjs`, `deploy-gates.mjs`) | all pass |
| E4 | `node --import tools/runtime-env.mjs` with a Staging boundary and no stamp | process refused to start: `ENVIRONMENT_STAMP_MISSING`, exit 1. Without a boundary it starts unchanged |
| E5 | `test-isolation.ps1` against a **rehearsal layout** (two real PostgreSQL 17.11 clusters created with the engine's `initdb` settings, scratch folder, not `C:\NIPT-CBH`) | 12 PASS, 1 NOT_RUN (egress firewall: needs elevation), 0 FAIL |
| E6 | `preflight.ps1` on this host | 13 PASS, 9 WARN, 6 BLOCKED (listed under Blockers) |
| E7 | Source-guard rules applied to all changed files | pass |
| E8 | Office COM probe in the owner's interactive session (session 1, Windows PowerShell 5.1, synthetic text) | Excel 16.0: workbook → PDF exported (91 KB, `%PDF-`). Word 16: automation **did not complete**; a hidden Word instance stayed running after `Quit` and the next run hung inside Word (typical of a first-run, activation or privacy dialog). The three probe-started Office processes were stopped by PID |

CI evidence is recorded on the pull request (`foundation.yml`: typecheck, lint, vitest, Next build, deploy contracts).

## Isolation

| Requirement | Status | Evidence / remaining |
|---|---|---|
| Staging cannot use its credentials on the Production database | **PARTIAL** | E5: migrator, web and worker credentials refused (`password authentication failed`); positive control connects to Staging; Production DB absent from the Staging cluster. Repeat on the installed environments: `test-isolation.ps1` |
| Both clusters listen on loopback only | **PARTIAL** | E5 on rehearsal clusters; repeat on installed environments |
| Staging cannot write Production folders | **PARTIAL** | Application layer: E1 + E5 refuse Production paths. NTFS deny for `nipt-stg-svc`: `provision-identities.ps1` not run (needs elevation and installed roots) |
| Staging cannot send to real HIS/NAS | **PARTIAL** | E1 + E5: with **no** firewall rule present, UNC HIS/NAS paths (by name or IP), mapped drives and a remote archive are refused by the application itself, and an enforced share policy is required at start. The supervisor refuses to start a stamped Staging root whose configuration lost its environment (E1). Local-only identity and egress firewall not yet provisioned |
| Production gate refuses a Staging that was never installed or never ran the workflow | **PASS** | E1: no verification record → `STAGING_VERIFICATION_MISSING`; installed but journey absent, failed or for another commit → `STAGING_WORKFLOW_UAT_NOT_PASSED`; the UAT requirement only lifts on an explicit `requireStagingJourney: false` |
| Separate ports, accounts, signing keys, roots | **PASS** | E1: shared root, instance, port, signing key or service account refused; E5 for separate clusters and secrets. Accounts themselves not yet created |
| Excel bridge / Word and Excel PDF in the interactive session | **PARTIAL** | E8: Excel PDF works interactively. Bridge itself not run (needs an installed environment and PowerShell 7). Word **BLOCKED** (see Blockers) |
| Resetting Staging does not modify Production | **BLOCKED** | `test-isolation.ps1 -IncludeReset` fingerprints Production around a reset; needs both environments installed |
| No shared secrets | **PARTIAL** | E5 compared all secrets by hash; repeat on installed environments |

## Deployment

| Requirement | Status | Evidence / remaining |
|---|---|---|
| Staging builds and deploys | **BLOCKED** | npm, PowerShell 7, Chromium and the approved assets are missing (E6) |
| Production build reproducible from the verified build | **PARTIAL** | Gate requires an equal release-payload digest (E1); not yet exercised on a real build |
| One-command Production deploy, no EXE | **PARTIAL** | `deploy-production.ps1` implemented; gate logic tested (E1); not executed |
| Failed deployment keeps the previous release | **PARTIAL** | Existing engine behaviour (auto-rollback on health failure, old release kept on migration failure), covered by the existing installer tests; not executed here |
| Compatible application rollback | **PARTIAL** | `rollback-production.ps1` uses the engine's schema-compatibility gate; not executed |
| Reboot restores services | **BLOCKED** | needs installed environments; supervisor task moves to system startup in `provision-identities.ps1` |
| Deployment records (revision, release, time, outcome) | **PARTIAL** | `history\<env>\<run>\record.json` + `deployments.jsonl` written by every run; not yet produced by a real deployment |

## Application (on Staging)

Login/RBAC, ANC and LAB registration, Task List, workbook generation, pooling, HALOS/NIFTY export, PDF generation,
worker operations, HIS simulator and archive simulation are all **BLOCKED** until Staging is installed. They are then
covered by `reset-staging.ps1 -Seed` (the existing 45-patient installed journey) plus staff browser UAT. The journey does
not cover EQA, Twin, No Call/repeat or worker-failure recovery; those need separate staff UAT scenarios.

## Database

| Requirement | Status | Evidence / remaining |
|---|---|---|
| Migration checksums | **PARTIAL** | Unchanged forward-only ledger; Production gate requires the same checksum to have run on Staging (E1); `nipt-admin schema` reports compatibility. Not executed on an installed database |
| Role privileges | **BLOCKED** | engine `health` checks `rolesRestricted`; needs installation |
| Destructive migrations never automatic | **PASS** | E1: destructive SQL detected and refused without `-AllowDestructiveMigration` |
| Backup / restore rehearsal | **BLOCKED** | engine `dr-drill`; needs installation |
| Failed-migration handling | **PARTIAL** | existing engine behaviour; not executed here |

## Not verified on this host

`npm run typecheck`, `lint`, `test` (vitest) and `next build` could not run (no npm). The TypeScript changes are
unverified by the compiler: the boundary import in `authorized-share.ts` and `archive-core.ts`, and the new route
`src/app/api/admin/deployment/route.ts`. CI (`foundation.yml`) runs all of them, plus the new `tests/deploy/*.node.mjs`,
on the next push.

## Blockers (from E6)

1. **Combined Excel Master** missing (pinned `4c5300f9…`, `packages/workbook/master-manifest.json`). Not found anywhere
   on this machine. Supply it from `NIPT-CBH-HOME-BACKUP`. Install is refused without it.
2. **ANC Request/Consent PDFs** are not yet in `C:\NIPT-CBH\assets\forms`. Hash-matching copies exist in an earlier
   Codex work folder on this host, but should be copied from the owner's backup.
3. **Node 24 + npm, PowerShell 7, Chromium headless shell** are not installed for builds (README §1).
4. **Production bootstrap identities** are still placeholders in `production.json`.
5. **Elevation** is needed for `provision-identities.ps1`, firewall rules and certificate trust.
6. **Trusted TLS** for `https://nipt-cbh` needs a hospital certificate or IT trust deployment.
7. **Word automation** does not complete when started hidden (E8). Sign in as the account that will run the Excel/Word
   bridge, open Word once, clear any first-run, activation or privacy dialog, then run `nipt.cmd office-check` after
   installation. Signed result PDFs depend on this.
8. **DNS**: `nipt-cbh` currently also resolves to the Wi-Fi hotspot address on this host. Hospital DNS should map it to
   the server's LAN address only.

## Findings for the owner / IT

- The GitHub repository is **public**. Templates contain no credentials, IP addresses or share paths; live configuration
  stays on the server. Make the repository private before committing internal deployment configuration.
- A PostgreSQL 17 Windows service outside NIPT-CBH listens on **all interfaces on port 5433**. NIPT environments do not
  use it. Restrict it to loopback or retire it with IT. It was not changed.
- Running Staging deploys/resets under dedicated identities requires an elevated prompt, because verifying another
  account's processes needs it. The scripts refuse up front rather than failing half-way.
