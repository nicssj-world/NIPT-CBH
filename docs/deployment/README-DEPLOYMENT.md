# NIPT-CBH direct deployment on Windows (Staging + Production, no Setup/Update EXE)

This guide is for the owner or IT administrator of the dedicated NIPT-CBH Windows server. It covers installing the
deployment tools, deploying a commit to **Staging**, testing it, and promoting the same verified build to **Production**
with one PowerShell command. The Setup/Update EXE is not used. See
[STAGING-PRODUCTION-ARCHITECTURE.md](STAGING-PRODUCTION-ARCHITECTURE.md) for how the two environments are kept apart, and
[RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md) for what has been verified so far.

> The GitHub repository is currently **public**. Never commit `environments\*.json`, `toolchain.json`, keys, assets or
> `history\`. They live only under `C:\NIPT-CBH` on the server. Make the repository private before storing any internal
> deployment configuration in it.

## 1. One-time host preparation

Run in a normal PowerShell window unless a step says *elevated*.

| What | Where | How |
|---|---|---|
| Git for Windows | on `PATH` | already installed on this host |
| Node.js **24** (Windows x64 zip, includes npm) | `C:\NIPT-CBH\toolchain\node` | download `node-v24.x-win-x64.zip` from nodejs.org/dist, check it against that release's `SHASUMS256.txt`, extract so `C:\NIPT-CBH\toolchain\node\node.exe` and `npm.cmd` exist; the path must not contain spaces |
| PostgreSQL **17** binaries | `C:\Program Files\PostgreSQL\17` | already installed (used only as binaries; each environment gets its own private cluster) |
| PowerShell **7** | `C:\NIPT-CBH\toolchain\pwsh7` | extract the official `PowerShell-7.x-win-x64.zip` from github.com/PowerShell/PowerShell releases after checking its SHA-256 against the release's `hashes.sha256` (no elevation needed; the native Excel export needs it). An MSI install in `C:\Program Files\PowerShell\7` also works: set `powershell7Home` accordingly |
| Microsoft Office (Excel + Word) | registered | already installed |

```powershell
# source checkout (the only place code is edited)
git clone https://github.com/nicssj-world/NIPT-CBH.git C:\NIPT-CBH\source\NIPT-CBH
cd C:\NIPT-CBH\source\NIPT-CBH
git switch <branch or tag that contains deploy\windows>

# Chromium for the PDF renderer, at the revision the lockfile pins
$env:Path = "C:\NIPT-CBH\toolchain\node;$env:Path"
$env:PLAYWRIGHT_BROWSERS_PATH = 'C:\NIPT-CBH\toolchain\ms-playwright'
npm ci
npx playwright install chromium

# deployment tools -> C:\NIPT-CBH\deploy (an explicit step: pulling or editing source never changes them)
powershell -ExecutionPolicy Bypass -File .\deploy\windows\Install-DeployTools.ps1
```

`Install-DeployTools.ps1` creates `C:\NIPT-CBH\deploy\environments\staging.json`, `production.json` and `toolchain.json`
from the templates **only if they do not exist**. Review them:

- `production.json` → `bootstrap`: `adminUser` and `adminName` of the ONE first account, APP_ADMIN (owner decision 2026-11-01; no
  defaults). A second bootstrap account (`checkerUser`/`checkerName`) is refused: other users, including the Reported By /
  Approved By personnel, are added afterwards in user management (see "Single APP_ADMIN and report personnel" below).
- `production.json` → `lan.host`: `nipt-cbh` (hospital DNS must resolve it to the server's LAN address only).
- Ports, roots and service account names normally stay as shipped.

### Approved clinical assets (from `NIPT-CBH-HOME-BACKUP`)

Copy, do not edit:

| File | Destination | Pinned SHA-256 (in the repository) |
|---|---|---|
| Combined Excel Master | `C:\NIPT-CBH\assets\approved-master.xlsx` | `packages/workbook/master-manifest.json` |
| ANC Request PDF (BM17) | `C:\NIPT-CBH\assets\forms\request.pdf` | `tools/win-installer/form-assets.mjs` (`request`) |
| ANC Consent PDF (BM17) | `C:\NIPT-CBH\assets\forms\consent.pdf` | `tools/win-installer/form-assets.mjs` (`consent`) |

Builds and preflight refuse files whose hash differs. No substitute template is ever used. The Singleton/Twin DOCX masters
and HALOS/NIFTY/Pooling templates follow the existing application paths and their own pinned manifests; this tooling does
not replace them.

### Check the host

```powershell
cd C:\NIPT-CBH
.\deploy\preflight.ps1
```

Every line is PASS, WARN or BLOCKED. Deploy only when nothing is BLOCKED.

## 2. Develop → Staging

Work in a feature branch in `C:\NIPT-CBH\source\NIPT-CBH` (locally, or with VS Code Remote-SSH to the server using key-based
OpenSSH; never edit anything under `C:\NIPT-CBH\staging` or `C:\NIPT-CBH\production`). Commit, then:

```powershell
cd C:\NIPT-CBH
.\deploy\deploy-staging.ps1 -Ref feat/my-change           # or a full commit SHA; default HEAD
.\deploy\deploy-staging.ps1 -Ref feat/my-change -Validation quick   # dependency install + deploy contracts only
```

What happens:
1. `-Ref` is resolved to one commit. Uncommitted changes are reported and **not** deployed.
2. A clean detached worktree is created at `C:\NIPT-CBH\source\builds\<sha12>`; `npm ci`, the deploy contract tests,
   `typecheck`, `lint`, `test:unit` and `guard` run there.
3. The signed **test-profile** package is built by the repository's `build-package.ts` with the Staging signing key.
4. First time, the engine installs `C:\NIPT-CBH\staging` (own PostgreSQL cluster, secrets, ports, startup task, six UAT
   accounts in `C:\NIPT-CBH\staging\credentials.txt`). Later runs upgrade it: verified backup, forward migrations,
   release switch, health check, automatic rollback if unhealthy.
5. Health, schema, environment stamp and database marker are checked. Success writes
   `deploy\history\staging\verified\<commit>.json`, which Production requires.

Staging opens at `https://localhost:8443` (loopback only).

### After the first Staging install (*elevated*, once)

```powershell
.\deploy\provision-identities.ps1 -Environment staging
```

This creates the local account `nipt-stg-svc`, applies NTFS boundaries, binds the share policy to it, moves the services to
system startup under that account, and blocks Staging's outbound network traffic. From then on, run Staging deploy, reset
and health commands from an **elevated** prompt (the scripts refuse otherwise, before changing anything).

### Workflow UAT and synthetic data

```powershell
.\deploy\reset-staging.ps1 -Seed        # type RESET STAGING when asked
.\deploy\test-isolation.ps1
```

`test-isolation.ps1` exits 0 only when every check ran and passed, 2 (INCOMPLETE) when a check could not run (for example
no egress firewall rule or service identity yet: each is an open security blocker), and 1 on a failure.

The owner-asset tests run only where the private clinical files are present (`.local\lab-owner-evidence`,
`.local\task3-sources`, from `NIPT-CBH-HOME-BACKUP`): `npm run test:owner-assets` in the source checkout. A missing file
fails the run. `npm test` excludes them, and CI never has them. On this Windows server also run
`npm run test:windows-native` (native `pg_dump.exe`/`pg_restore.exe` disaster-recovery test). The groups are listed in
`tests/test-groups.json`.

`reset-staging` recreates only the Staging database, after checking configuration, stamp, profile and the database's own
marker, and sets the previous synthetic files aside under `staging\backups\reset-<time>`. `-Seed` runs the existing
installed synthetic journey: 45 test patients through simulated HIS PET files, Request/Consent, Lab Run, Pooling,
Sequencing, Results, release and outbound RES/PDF into Staging folders. The result is recorded as that commit's workflow UAT.
Browser UAT by staff uses the UAT accounts.

## 3. Staging → Production

```powershell
git -C C:\NIPT-CBH\source\NIPT-CBH fetch origin          # the gate checks the commit is on origin/main
.\deploy\deploy-production.ps1 -Commit <40-character sha> -ApprovedBy "<name>" -ChangeReference "<change ticket>"
# type DEPLOY PRODUCTION <first 7 of the sha> when asked
```

The gate lists every failure and changes nothing unless all of these hold:
- the commit was deployed to Staging successfully within `stagingVerifiedMaxAgeDays`, and its workflow UAT passed;
- the commit is on `releaseBranch`;
- the Production package's release payload is **byte-identical** to the one Staging verified (no rebuild);
- every pending Production migration already ran on Staging with the same checksum, the Production ledger is compatible,
  and any destructive SQL is named in `-AllowDestructiveMigration <file.sql>`;
- approver, change reference and the typed confirmation are given.

Then the engine installs (first time: creates the one APP_ADMIN account and takes the first verified backup) or upgrades.
Upgrades take a verified backup, apply forward migrations, switch release, check health and roll back automatically if
unhealthy. First-time sign-in passwords are in `C:\NIPT-CBH\production\credentials.txt`; deliver them, then delete the file.

After the first Production install (*elevated*, once): `.\deploy\provision-identities.ps1 -Environment production`.

### HIS share access for the service identity

Production's web, worker and renderer run as `nipt-prd-svc`, a local account, so they have **no SMB session of their own** to the
HIS server: the folder check that runs when an administrator saves a HIS path in Settings (in the web request) and the worker's
scans both use that account's Windows Credential Manager. A path that works in File Explorer for the signed-in administrator
fails for the service until that credential exists. Symptom in Settings: "can't read or write files in this folder, not saved".

Nobody stores the service account's password (and resetting it would destroy its DPAPI-protected NAS credential), so the
credential is handed over through the identity's own scheduled task instead of a sign-in as it. From an elevated prompt:

```powershell
powershell -ExecutionPolicy Bypass -File C:\NIPT-CBH\deploy\history\elevated-his-smb.ps1 -InboundPath '\\<his>\<share>\<inbound folder>'
# optional outbound check, named destinations only (temporary dot-file: write, read back, remove):
#   ... -ResPath '\\<his>\...' -PdfPath '\\<his>\...' -BackupPath '\\<his>\...'
```

It asks once for the HIS account password (hidden). The password is protected with DPAPI (machine scope), left in
`production\run\smb-credential.request`, stored by `nipt-prd-svc` itself with `CredWrite` (no command line) and the request is
deleted at once. It then runs the application's own save-time check (`packages/settings/his-check.ts`) **as `nipt-prd-svc`**
before and after storing the credential and after a Production restart, and writes the results (identity, counts, codes; no file
names or secrets) to `deploy\history\his-smb\`. Inbound is read-only; the HIS password is never written to Git, logs or files in clear.

### Production NAS backup (owner decision 2026-11-01)

`production.json` names the destination (not in Git):

```json
"backup": { "root": "\\\\<nas>\\<share>\\NIPT-CBH-system-backup", "nasUser": "<nas account>", "nasTargets": ["<nas IP>"], "dailyAt": "02:00", "keep": 30 }
```

`provision-identities.ps1 -Environment production` then, in the elevated window:

1. asks once for the NAS account's password and stores it only in the **service account's own** Windows Credential Manager
   (`cmdkey` run as `nipt-prd-svc`); no file, no Git, no plaintext configuration;
2. proves the service account can write, read back and remove a temporary file on the share;
3. points the engine at the share (`set-backup-root`), schedules the daily backup with retention (`schedule-backup --keep 30`:
   only this installation's own `operational-*` folders listed in its `index.json` are ever removed) and moves that task to
   the service account, so it runs at 02:00 whether or not anyone is signed in;
4. runs one backup immediately through that task and checks the NAS index and Production health afterwards.

C: and D: are one physical disk and the USB drives are removable, so neither is a Production backup destination. The backup
encryption key stays in `C:\NIPT-CBH\production\secrets\backup.key`: escrow a copy separately (a backup cannot be restored
without it). Verify restore with `nipt.cmd dr-drill` (backup, then restore into a NEW database and folder, both removed
afterwards; the live database is never touched).

### Single APP_ADMIN and report personnel (owner decision 2026-11-01)

- Production starts with **one application account, APP_ADMIN**, with full application authority: administration, users,
  ANC and LAB, registration, runs, QC, reporting, clinical review, PDF and publication, HIS/NAS configuration, audit. It
  always acts as itself: every record keeps the administrator as the operator (`operator_id`, `certified_by`, `reviewer_id`,
  audit actor). Migration `161_app_admin_operator_authority.sql` lets the database guards accept a current APP_ADMIN as the
  acting user.
- Not inherited: signing as the patient, sending historical results, the hard HIS production switch, redraw after release,
  historical promotion (Historical Verifier only; migration not started), and **self-approval**. Where a rule needs two
  different people (maker and checker of a clinical setting, worksheet author and peer reviewer, a signer profile and its
  verifier), it still needs two people: add the second person in user management. Example: the report interpretation
  setting is proposed by a LAB_CERTIFIER and approved and activated by the APP_ADMIN.
- **Reported By (ผู้รายงานผล) / Approved By (ผู้รับรองผล)** are two separate selections in the reporting screen, made by the
  administrator in one session. The record stores each named person (`reported_by`, `approved_by`, their verified signer
  profile), the operator (`operator_id`) and the evidence for each (`*_authority`: `SELF` or `STANDING_DELEGATION` with
  the authority reference) and the time stamps. A name alone is not evidence: a person can be selected and printed with their
  signature only when
  1. they are a user with LAB_STAFF (Reported By) or LAB_CERTIFIER (Approved By), created by the administrator;
  2. they signed in **themselves** once and submitted their legal name, MT licence and signature image (Own profile);
  3. a different administrator verified that profile (the APP_ADMIN can verify other people's profiles);
  4. they granted the administrator a standing delegation for that role, citing the hospital's authority reference.

  Without 2-4 the person is listed as not usable and finalising is refused (`SIGNER_PROFILE_NOT_VERIFIED`,
  `SIGNATURE_DELEGATION_REQUIRED`). Nothing is marked approved without it.
- The Windows service identity (`nipt-prd-svc`) is unrelated to application accounts: it only runs the background services.

## 3a. Staging is on demand (owner decision)

Production is always on. Staging stays installed but **stopped**, and it does not start at logon or after a reboot. Start it
only to test a release, then stop it again.

| Task | Command (from `C:\NIPT-CBH`, elevated once identities are provisioned) |
|---|---|
| Is Staging running? | `.\deploy\staging-status.ps1` |
| Start Staging | `.\deploy\start-staging.ps1 -Reason "<why>"` |
| Open Staging | `https://localhost:8443` on the server (loopback only); UAT accounts in `C:\NIPT-CBH\staging\credentials.txt` |
| Test a feature | commit it, then `.\deploy\deploy-staging.ps1 -Ref <branch or sha>` (Staging must be started) |
| Reset synthetic data | `.\deploy\reset-staging.ps1` (Staging database only; old files kept under `staging\backups\reset-*`) |
| Workflow UAT | `.\deploy\reset-staging.ps1 -Seed` (45 synthetic patients through the whole workflow); the result is recorded for the commit Staging runs |
| Stop Staging | `.\deploy\stop-staging.ps1 -Reason "<why>"` |
| Promote | see section 3 (`deploy-production.ps1 -Commit <the exact sha Staging verified>`); Staging may stay stopped |

- **start-staging** refuses, changing nothing, when the environment identity is wrong, when the dedicated service identity
  or the Staging egress firewall block is missing, or when free memory is below `staging.json` `startRequires`
  (default 3 GB commit and 1.5 GB physical). Measured Staging footprint: 22–23 processes, about 0.55 GB private memory,
  about 1 GB of commit. It starts only Staging's own processes and the Excel bridge in the signed-in owner's session.
  Repeating it starts nothing twice.
- **stop-staging** waits for active jobs (`-DrainSeconds`, default 120). Queued or unfinished jobs stay in the Staging
  database and run again at the next start. It then stops the Worker gracefully, the apps, PostgreSQL (fast shutdown) and
  the bridge, and disables both Staging tasks. It verifies that no process from `C:\NIPT-CBH\staging\runtime` remains and
  that Production and the `postgresql-x64-17` service are unchanged. Repeating it is safe.
- `deploy-staging` and `reset-staging` refuse a stopped Staging (`STAGING_STOPPED`) instead of starting it silently.
- A release verified on Staging stays promotable while Staging is stopped: the gate reads the recorded evidence for that
  exact commit, never Staging's live state.

### Memory

The server has 15.7 GB RAM and a system-managed pagefile, which gives a commit limit of 18–19 GB. Desktop applications
alone (browser, editors) used 10 GB or more of it during commissioning. When the commit limit is reached, Windows kills
processes: on 2026-11-01 a Staging PostgreSQL backend was killed with `0xC000012D STATUS_COMMITMENT_LIMIT`.

- Check: `.\deploy\staging-status.ps1` (memory line), or Task Manager → Performance → Memory → "Committed".
- Keep Staging stopped unless testing. Do not run builds or browser test suites on this server while Production is in
  use; GitHub Actions runs the full suite.
- Ask IT to set a fixed pagefile (for example 16 GB, per hospital policy) or add RAM before clinical use.

### Staging does not stop

1. `.\deploy\staging-status.ps1` shows what still runs.
2. Run `.\deploy\stop-staging.ps1` again (it is idempotent).
3. If processes from `C:\NIPT-CBH\staging\runtime` remain: as administrator,
   `C:\NIPT-CBH\staging\nipt.cmd stop`, then stop **only** those PIDs (`Get-CimInstance Win32_Process | ? ExecutablePath -like 'C:\NIPT-CBH\staging\runtime\*'`).
   Never stop Excel, Word or any process that is not under that folder.
4. The data stays in `C:\NIPT-CBH\staging\data`. PostgreSQL recovers automatically at the next start.

## 4. Operate

```powershell
.\deploy\health-check.ps1                      # both environments: release, commit, schema, services, boundary, backup
.\deploy\rollback-production.ps1 -Reason "<why, change ticket>"   # previous application release; database unchanged
C:\NIPT-CBH\production\nipt.cmd backup          # verified backup (existing engine)
C:\NIPT-CBH\production\nipt.cmd backups         # list
C:\NIPT-CBH\production\nipt.cmd dr-drill        # backup + restore rehearsal into a quarantined copy
C:\NIPT-CBH\production\nipt.cmd schedule-backup
```

The APP_ADMIN can also open `GET /api/admin/deployment` in the application. It returns the environment, application version,
release ID, commit and schema state.

**Reboot check:** restart Windows, sign in (the Excel bridge runs in the owner's session), then run `.\deploy\health-check.ps1`.

### Database rollback

An application rollback never changes the database. `rollback-production.ps1` refuses
(`ROLLBACK_REQUIRES_DATABASE_RESTORE`) when the database has a migration the previous release does not know; Production then
keeps running the current release. Returning to an older schema means restoring the pre-upgrade backup recorded in the
deployment record (`preUpgradeBackup`) with the engine's `restore` command. That discards later clinical work, so it needs
an authorised, documented procedure.

### Trusted TLS for `https://nipt-cbh`

The engine creates a self-signed certificate (`C:\NIPT-CBH\production\config\tls`). For hospital clients, obtain a server
certificate for `nipt-cbh` from hospital IT (or trust the generated one through IT's certificate deployment) and replace
`server.pfx`/`server.cer`/`server.pem`, then restart Production. This step needs hospital IT and is not automated.

## 5. Where things are

| Path | Contents |
|---|---|
| `C:\NIPT-CBH\source\NIPT-CBH` | Git checkout (edit here only) |
| `C:\NIPT-CBH\source\builds\<sha12>` | clean build worktrees, one per deployed commit (keep the one Production uses) |
| `C:\NIPT-CBH\staging`, `C:\NIPT-CBH\production` | environment roots (engine layout; never edit by hand) |
| `C:\NIPT-CBH\deploy` | tools, `environments\`, `toolchain.json`, `keys\<env>\`, `history\<env>\` (one folder per run: `run.log`, `record.json`; `deployments.jsonl`) |
| `C:\NIPT-CBH\assets` | approved clinical files (administrator only) |
| `C:\NIPT-CBH\documentation` | these documents |
