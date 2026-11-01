# Staging / Production architecture on one Windows server

Two independent NIPT-CBH installations share one machine and nothing else. Each is a complete installation made by the
existing Windows engine (`tools/win-installer/nipt-admin.mjs`). That engine already creates a private PostgreSQL cluster,
secrets, TLS, startup task, file store and Excel spool per install root. The deployment layer (`deploy/windows/`) drives
it from Git commits instead of from Setup/Update EXE files, and adds the environment boundary described below.

## Components and boundaries

| | Staging | Production |
|---|---|---|
| Root | `C:\NIPT-CBH\staging` | `C:\NIPT-CBH\production` |
| Engine instance / startup task | `nipt-staging` / `\NIPT-CBH\nipt-cbh-nipt-staging` | `nipt-cbh` / `\NIPT-CBH\nipt-cbh-nipt-cbh` |
| Package profile | `test` (six UAT accounts, test banner) | `production` (two named bootstrap accounts, no test accounts) |
| PostgreSQL | own cluster `staging\data\pgdata`, `127.0.0.1:55442` | own cluster `production\data\pgdata`, `127.0.0.1:55432` |
| Database | `nipt_operational_nipt_staging`, comment `NIPT_ENVIRONMENT=staging` | `nipt_operational_nipt_cbh`, comment `NIPT_ENVIRONMENT=production` |
| DB roles | `nipt_migrator` (cluster owner), `nipt_web`, `nipt_worker`, random passwords per cluster | same names, different random passwords |
| Web (Next.js) | `127.0.0.1:3010` | `127.0.0.1:3000` |
| PDF renderer | `127.0.0.1:3011` | `127.0.0.1:3001` |
| HTTPS front | `127.0.0.1:8443` (loopback only) | `0.0.0.0:443`, firewall-scoped to the hospital LAN, `https://nipt-cbh` |
| Worker / queues | own process, pg-boss inside its own database | own process, pg-boss inside its own database |
| Excel bridge | task `...-nipt-staging-excel-bridge`, spool `staging\data\excel-spool` | task `...-nipt-cbh-excel-bridge`, spool `production\data\excel-spool` |
| File store | `staging\data\files` | `production\data\files` |
| HIS / NAS | simulator folders `staging\data\integration\{inbound,outbound,results}` only | hospital shares once approved and configured in Settings (disabled until then) |
| Secrets | `staging\secrets` | `production\secrets` |
| Logs | `staging\logs` | `production\logs` |
| Service identity | local `nipt-stg-svc` | local `nipt-prd-svc` |
| Package signing key | `deploy\keys\staging\` | `deploy\keys\production\` (a Staging-signed package cannot be installed on Production) |

`deploy-gates.mjs` refuses two definitions that share a root, instance, port, signing key or service account.

### Differences from the requested folder layout

- `databases\staging|production` is not a separate folder. Each cluster lives in its root's `data\pgdata`, because backup,
  restore, upgrade and rollback in the engine all assume that layout. Moving it would fork tested code. The clusters are
  still separate instances with separate data directories.
- `excel-bridge\` is the root's `data\excel-spool`, plus the per-instance bridge task.
- `runtime\` holds Node, PostgreSQL binaries, PowerShell 7 and Chromium copied from the package, so each environment runs
  its own runtime binaries. The Staging egress firewall rules depend on that.

## How Staging is kept away from Production and the hospital

The rule is fail closed, enforced in several independent layers. None of them depends on a UI toggle or on `NIPT_MODE`.

1. **Separate database instances.** Different clusters, ports and random passwords. Staging credentials are refused by
   the Production cluster (`test-isolation.ps1`, `database` checks). Both clusters listen on `127.0.0.1` only.
2. **Environment boundary in the application** (`tools/environment-boundary.mjs`). It is preloaded into every service
   through `tools/runtime-env.mjs` and applied again on every share access (`packages/integrations/authorized-share.ts`)
   and to the NAS archive root (`packages/results/archive-core.ts`). The supervisor sets `NIPT_ENVIRONMENT`, the root,
   the protected (other environment's) root and the expected database port from the validated configuration, after
   everything inherited, so nothing can widen them. In Staging:
   - a service does not start unless `environment.json` in its root names the same environment;
   - its database URL must be loopback on Staging's port;
   - the file store, simulator, policy and spool paths must be inside the Staging root;
   - HIS share access is limited to the policy file's grants (`NIPT_HIS_SHARE_POLICY_ENFORCE=1`). A folder typed into
     Settings is not enough. Any UNC path, any path outside the Staging root and any path inside the Production root is
     refused (`ENVIRONMENT_STAGING_REMOTE_PATH_PROHIBITED`, `..._PATH_OUTSIDE_ROOT`, `ENVIRONMENT_PROTECTED_PATH_PROHIBITED`);
   - the NAS archive may only be a share on this machine (`\\localhost\...`, the archive simulator).

   Production keeps hospital UNC shares but can never write into the Staging root. An installation without
   `NIPT_ENVIRONMENT` (made before this layout) behaves exactly as before.
3. **Identity and NTFS** (`provision-identities.ps1`). Each environment runs as a local account with no domain identity,
   so it cannot authenticate to hospital SMB shares. Each root has inheritance removed. Only Administrators, SYSTEM, the
   deploying administrator and its own account have access, and the other environment's account is explicitly denied.
4. **Network.** Staging's own `node.exe`, `postgres.exe` and `pwsh.exe` are blocked outbound to every non-loopback address.
   SMB file access is performed by the Windows kernel rather than by `node.exe`, so the firewall does not cover SMB. Layers
   2 and 3 do.
5. **Database marker.** `reset-staging` drops a database only when the configuration, stamp, test profile and the
   database's own `NIPT_ENVIRONMENT=staging` comment all agree.

## Release flow

```text
feature branch ─ commit ─▶ deploy-staging.ps1 ─▶ clean worktree @sha ─▶ npm ci + checks ─▶ test package (Staging key)
                                      │                                   └──── .next build kept in the worktree
                                      ▼
                     Staging install/upgrade ─▶ health + schema + boundary ─▶ verified\<sha>.json
                                      ▼
                     reset-staging -Seed (workflow UAT) ─▶ journey result recorded for <sha>
                                      ▼
deploy-production.ps1 -Commit <sha> ─▶ production package from the SAME build (--skip-build, Production key)
                                      ▼
   gate: verified, recent, UAT passed, on release branch, payload digest equal, migrations rehearsed, no unapproved destructive SQL,
         approver + change reference + typed confirmation
                                      ▼
                     Production install/upgrade ─▶ health + schema + boundary ─▶ history\production\
```

- **Release ID** (package version, release folder name): `<appVersion>-d<UTC yyyymmddhhmmss>.<sha7>`. It orders correctly
  under the engine's version rules. `appVersion` comes from `deploy/windows/app-version.json` at the deployed commit, not
  from `package.json` or a branch name.
- **Immutable releases.** Each deployment is a new `releases\<release ID>` folder. The previous one stays for rollback,
  and the switch is the engine's `install-state.json` update (no symbolic links, no administrator rights needed).
- **Migrations** are forward-only with SHA-256 checksums (`tools/migrate.ts`). Historical checksums are untouched.
  Production runs a migration only after the same file with the same checksum has run on Staging.
- **Rollback** is application only, and is refused when the database is newer than the previous release.
- **Worker drain** uses the engine's supervisor: `STOP_WORKER` over IPC for a graceful stop, for the targeted root only.

## Version and status reporting

| Item | Source |
|---|---|
| Application version | `deploy/windows/app-version.json` at the commit (starts at the v1.1.2 baseline) |
| Git commit | `install-state.json` `current.revision`; `NIPT_SOURCE_SHA` in the services |
| Schema version | migration ledger (`nipt-admin schema`: applied, last, pending, compatibility) |
| Release ID | `install-state.json` `current.version`; `NIPT_RELEASE_VERSION` in the services |

Shown by `health-check.ps1` and, for APP_ADMIN, by `GET /api/admin/deployment`.

## Candidate work not in this baseline

`backup/home-update-113-20261030` (v1.1.3 in progress) and `backup/home-parity-20261030` (parity remediation) overlap and
are **not** merged. Each must be integrated on its own branch, deployed to Staging, and pass the gate like any other commit.
A release is called 1.1.3 only when `app-version.json` says so on a validated commit.
