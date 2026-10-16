# NIPT-CBH Home Operational UAT Checklist

**Environment label:** TRAINING / LOCAL UAT — NOT FOR CLINICAL USE
**URL:** `https://127.0.0.1:19444/login`
**Data:** fake local test identities only; no hospital HIS/HALOS, shared folder, instrument, or external destination is connected.

## Start and access

1. In PowerShell, run `pwsh -NoProfile -File tools/operational/Home-UAT.ps1 -Action Start` from this worktree. Start reports Health JSON and leaves the services and data running.
2. Open the URL above. The local Caddy certificate is generated for loopback; if the browser shows its local certificate warning, confirm the address is exactly `127.0.0.1` before continuing. Do not install a machine-wide certificate.
3. Read the six usernames and passwords from `.local/home-operational-uat/credentials.txt`. That file is ACL-restricted to the current Windows user, Administrators, and SYSTEM. Never copy the credentials into a shared folder or ticket.
4. Sign out between roles. Use `uat.admin` for configuration proposals, `uat.lab` for registration and lab work, `uat.certifier` for laboratory evidence review, `uat.clinical-approver` for approval, `uat.auditor` for read-only review, and `uat.anc` for scoped ANC intake. The application permissions remain authoritative.

## Owner workflow checks

- Confirm the training banner appears on Login and after signing in. Check that invalid credentials are rejected and that each account sees only its permitted actions.
- In Registration, create only clearly fake records. To stage a matching local PET/OK after registering its listed LN, run `pwsh -NoProfile -File tools/operational/Home-UAT.ps1 -Action StagePET -FixtureId S1-01`. Other IDs are `TWIN-01`, `RE-LIB-01`, `S2-01`, and `BATCH-05` through `BATCH-45`. Fixture details are in `.local/home-operational-uat/fixtures/case-list.csv`.
- Check Sample Receive and the local PET/OK queue, then inspect the LN Halos preview and the 50 × 20 mm label preview. Physical label printing is not part of this verified setup; confirm the selected printer and calibration locally before printing anything.
- Create or use the local Batch and Task List 1–3 records. Enter only observations you can identify as training data. Review QC1–QC5, pooling, sequencing and maker/checker decisions as separate steps; observe a HOLD when the required evidence or approval is absent. Never override a HOLD to complete this checklist.
- Use the supplied fake singleton/twin and positive/negative/notice report PDFs only where the application requests a controlled test artifact. POS/NEG/BLANK controls must be created through the existing controlled workflow; the fixture pack does not directly insert control or clinical records.
- Export XLSX and selected PDF sheets from the Browser. The PDF job uses Microsoft Excel Desktop on the Windows Host through the private local spool. A working Renderer does not establish Excel export readiness; confirm the exported artifact and Health output reports the local Excel bridge as `IDLE`.
- Review and release only through the existing roles and gates. The P6 RES/OK outputs are local simulation artifacts; `hisConfirmed=false` means no hospital system acknowledged them.
- Restart with `pwsh -NoProfile -File tools/operational/Home-UAT.ps1 -Action Restart`. Confirm its before/after case, batch, release, and transfer counts match, then log back in and reopen a previously viewed training case.

## Controls and stopping

- Health: `pwsh -NoProfile -File tools/operational/Home-UAT.ps1 -Action Health`
- Recent service logs: `pwsh -NoProfile -File tools/operational/Home-UAT.ps1 -Action Logs`
- Stop services without deleting data or volumes: `pwsh -NoProfile -File tools/operational/Home-UAT.ps1 -Action Stop`
- Start the same retained environment later with the Start command above. Do not use `docker compose down -v` or remove the named volumes.

Only the UAT compose project publishes ports, and those ports bind to loopback. Database, renderer, web, worker, file-store, Excel spool and simulator belong to this separate project. The approved Combined Master is mounted read-only and its expected SHA-256 is `0f94efbc240b9a38ff9be77bf0c8d92c09d82fa2fe2427b9d274cc739e5607a6`.
