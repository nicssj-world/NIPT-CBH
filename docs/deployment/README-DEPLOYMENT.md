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

- `production.json` → `bootstrap`: the real APP_ADMIN and CLINICAL_APPROVER usernames and display names (no defaults).
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

Then the engine installs (first time: creates the two bootstrap accounts and takes the first verified backup) or upgrades.
Upgrades take a verified backup, apply forward migrations, switch release, check health and roll back automatically if
unhealthy. First-time sign-in passwords are in `C:\NIPT-CBH\production\credentials.txt`; deliver them, then delete the file.

After the first Production install (*elevated*, once): `.\deploy\provision-identities.ps1 -Environment production`.

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
