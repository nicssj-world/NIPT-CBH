# Hospital Windows installation — runbook and acceptance

Audience: hospital IT performing the installation on a **non-production** Windows host, then (only with separate written Owner authorization) on a production host. The installer, its commands and its safety rules are described in `docs/p8/windows-installer.md` and `docs/p8/windows-installer-runbook.md`; this document is the step-by-step procedure with acceptance tests and the places where evidence must be collected.

**Evidence status.** Every acceptance test below is marked with where it has already been executed. `DEV` = the developer machine (Windows 11, user-level startup task, loopback only; see `docs/p8/windows-installer-evidence.md` and `docs/release/release-candidate-report.md`). `HOSPITAL` = hospital infrastructure: **nothing has been executed there yet**; those cells are for IT to fill in. No result below was produced by anyone other than the stated test run.

## 1. Before you start

1. Complete `docs/release/hospital-preflight-checklist.md` (PF-01…PF-23) and keep `hostcheck.json`.
2. Obtain the package folder and the **public key** through separate channels. Record the SHA-256 of `manifest.json` from the release record and compare:
   `Get-FileHash <package>\manifest.json -Algorithm SHA256`.
3. Decide `-TaskMode` and `-ExcelMode` (checklist PF-04, PF-17). **Rule:** a SYSTEM startup task must use `-ExcelMode bridge`; Excel automation does not run in session 0.
4. Write down the authorized scope (test host or production) and who authorized it.

## 2. Install (clean installation)

Elevated PowerShell (needed for `-TaskMode system` and for the firewall rule):

```powershell
cd <package>\installer
powershell -ExecutionPolicy Bypass -File .\Nipt-Admin.ps1 verify-package -Root C:\NIPT-CBH -PublicKey E:\keys\package-signing-public.pem
powershell -ExecutionPolicy Bypass -File .\Nipt-Admin.ps1 preflight     -Root C:\NIPT-CBH -PublicKey E:\keys\package-signing-public.pem `
    -Rest --ports,5432,3000,443,3001,--master-workbook,D:\owner\NIPT_CBH_Final_Combined_Master.xlsx,--task-mode,system,--excel-mode,bridge,--excel-user,HOSPITAL\labuser
powershell -ExecutionPolicy Bypass -File .\Install-Nipt.ps1 -Root C:\NIPT-CBH -PublicKey E:\keys\package-signing-public.pem `
    -MasterWorkbook D:\owner\NIPT_CBH_Final_Combined_Master.xlsx -TaskMode system -Ports 5432,3000,443,3001 -Origin https://nipt.hospital.local
```

(`Install-Nipt.ps1` exposes `-Instance`, `-Ports`, `-Origin`, `-TaskMode`; pass `--excel-mode bridge --excel-user DOMAIN\name` through `Nipt-Admin.ps1 install` when using the bridge.) The installation ends with services running, the first verified backup, and a health report. It prints the credentials file (`C:\NIPT-CBH\credentials.txt`, six **test** accounts, restricted ACL). Replace the self-signed certificate with the hospital certificate before any user connects (§6).

Create the LAN firewall rule (elevated; subnet from IT):

```powershell
New-NetFirewallRule -DisplayName 'NIPT-CBH HTTPS (LAN)' -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow -Profile Domain,Private -RemoteAddress <hospital subnet>
```

Publishing on the LAN also needs the HTTPS front to listen on a LAN address: install with `--https-host 0.0.0.0` (or the host's address); the default is loopback. Do not open PostgreSQL (5432), web (3000) or renderer (3001).

## 3. Acceptance tests

| ID | Test | Procedure | Expected | DEV | HOSPITAL (result, tester, date) |
|---|---|---|---|---|---|
| INST-01 | Clean installation | §2 on an empty root | `installed:true`, health `ok:true`, `backupStatus: CHECKSUM_VERIFIED`, 47 migrations (001–104) | Passed (final direct run, S03) | |
| INST-02 | Start / stop / restart | `nipt.cmd stop` → no listener on the four ports; `nipt.cmd start`; `nipt.cmd restart` | stop is graceful (supervisor log has no `WORKER_GRACEFUL_STOP_TIMEOUT`), health `ok:true` after start | Passed (S14) | |
| INST-03 | **Windows reboot recovery** | reboot the host; **do not log on interactively unless the design needs it**; wait 3 minutes; from another machine open the URL; run `nipt.cmd health` | the supervisor starts from the startup task, all services up, health `ok:true` within 3 minutes of boot. With `-TaskMode user` the services start only when that user logs on | **Not executed** (user-level task only; no reboot test) | |
| INST-04 | SYSTEM task identity | `Get-ScheduledTask -TaskPath '\NIPT-CBH\'` shows principal `SYSTEM`; `Get-CimInstance Win32_Process` shows `node.exe`/`postgres.exe` owned by `NT AUTHORITY\SYSTEM` | task registered, processes owned by SYSTEM, none by an unexpected user | **Not executed** (session not Administrator) | |
| INST-05 | Excel bridge (SYSTEM mode) | log on as the bridge user; `nipt.cmd health` shows `excelBridge: "idle"`; export a Task List PDF from the UI | PDF produced (A4, page counts 2/2/2/1/1/1); no Excel dialog; `excelBridge` returns to `idle` | Bridge mode **Passed** as a user task (final bridge run, S03–S06); SYSTEM + bridge not executed | |
| INST-06 | Unexpected process termination | kill `worker`, `web`, `renderer` PIDs (`nipt.cmd status`) | each is restarted within seconds; health `ok:true`; no orphan, no stuck port | Passed (S05) | |
| INST-07 | Supervisor termination / stale children | `taskkill /PID <supervisor> /F`; then `nipt.cmd start` (or wait for the task restart) | services return; `logs\supervisor.log` shows `STALE_SERVICE_REAPED` if children survived | Passed for recovery; children did **not** survive under Task Scheduler, so reaping was not exercised | |
| INST-08 | LAN browser access | from a client PC: `https://nipt.hospital.local/login`; certificate padlock valid | page loads, no certificate warning, Thai text and fonts render | **Not executed** (loopback only) | |
| INST-09 | Authentication and role enforcement | sign in with each of the six test accounts; try a forbidden action for each role; sign out | forbidden actions are refused **server-side** (HTTP 403), training banner shown, mandatory password rotation honoured | Roles/scope covered by automated tests and the installed journey; UI walk-through not executed | |
| INST-10 | Worker, renderer, PostgreSQL | `nipt.cmd health` | `workerAlive`, `webReachable`, `rendererReachable`, `databaseReachable`, `migrationsMatch`, `auditValid`, `rolesRestricted` all true; `nipt_web`/`nipt_worker` not superusers | Passed (S04, S06) | |
| INST-11 | Logs and errors visible | open `C:\NIPT-CBH\logs\*.log`; trigger a harmless failure (stop the renderer PID) | supervisor, web, worker, renderer, postgres logs exist and show the event; restart logged | Passed (logs inspected during S05) | |
| INST-12 | Upgrade | `nipt.cmd upgrade --package <app-only package> --public-key <key>` | pre-upgrade backup taken, forward migrations applied, health `ok:true`, release pointer switched | Passed (S10, S12) | |
| INST-13 | Rollback / recovery restrictions | `nipt.cmd rollback` after an upgrade that applied a migration | refused with `ROLLBACK_REQUIRES_DATABASE_RESTORE`, nothing changes; application-only rollback works only when the database is not newer | Passed (S11, S12) | |
| INST-14 | Uninstall | `nipt.cmd uninstall --confirm <folder>` (data kept) | task removed, services gone, data and secrets still present; `--remove-data` removes everything | Passed (S15, S16) | |

## 4. Windows reboot test and SYSTEM-task procedure (for IT; not executed by the project)

Run only on an explicitly authorized test host, with administrator access.

1. Install with `-TaskMode system -ExcelMode bridge -ExcelUser <user>`. Record `Get-ScheduledTask -TaskPath '\NIPT-CBH\' | Format-List *` and the task's `Principal`.
2. `Restart-Computer`. After boot, **without logging on**, from another machine request `https://<host>/api/health` (expect `{"status":"ok"}`) every 15 s and note the time it first answers; this is the boot-to-ready time to put in the evidence record.
3. Log on as the bridge user; `nipt.cmd health` must show `excelBridge: "idle"` within one minute of the logon (the bridge task starts at that user's logon).
4. Kill the SYSTEM supervisor (`Stop-Process -Id <pid> -Force`): the task restarts it (restart-on-failure is 5 × 1 minute). Record the recovery time and that no child process is left holding ports.
5. `nipt.cmd stop`, confirm ports are free, `nipt.cmd start`.
6. `Get-CimInstance Win32_Process | Where CommandLine -like '*NIPT-CBH*' | Select ProcessId,Name,@{n='Owner';e={(Invoke-CimMethod -InputObject $_ -MethodName GetOwner).User}}` — all owned by `SYSTEM` (the Excel bridge by the interactive user).

Record the outcomes in the HOSPITAL column of §3. **Do not mark INST-03/04/05 passed without this evidence.**

## 5. Day-two operations and incident handling

| Situation | First action | Then |
|---|---|---|
| A service keeps restarting | read `logs\supervisor.log` and the service log; `nipt.cmd status` shows restart counts | do not edit `install-state.json`; escalate with the logs |
| Health shows `excelBridge` not idle | check the bridge user is logged on; `Get-ScheduledTask -TaskName '*excel-bridge'` | restart that task; if Excel shows a dialog, resolve it in that user session |
| Disk almost full | stop writing nothing manually; check `data\` and the backup destination | expand the volume or move the backup root (`set-backup-root`) |
| Certificate expires | replace `config\tls\server.pfx` and `.cer` with the hospital certificate | `nipt.cmd restart` |
| Need to go back to the previous release | follow `docs/release/rollback-recovery-decision-tree.md` | never edit the ledger |

## 6. Replacing the test certificate

The installer generates a self-signed certificate (`config\tls\server.pfx`, passphrase in `secrets\tls-passphrase`) for test use. For hospital use: obtain a certificate from the hospital CA whose SAN names the hostname, export as PFX, replace `config\tls\server.pfx` (and `server.cer`/`server.pem` for the health probe) while the services are stopped, update `secrets\tls-passphrase`, set the `-Origin` to the real URL in `config\nipt.json` (`origin`), then `nipt.cmd restart`. The `Secure` session cookies depend on the HTTPS origin; test the login after the change.

## 7. What this procedure does not authorize

Production installation, a production database, the Production HIS receiver, real patient data and real results require **separate explicit Owner authorization**. Windows Authenticode code-signing is not part of this package (the Ed25519 signature protects package integrity only).
