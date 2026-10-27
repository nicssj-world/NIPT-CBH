# NIPT-CBH Update 1.1.1 — Admin System Settings saved directly

## What it is
`NIPT-CBH-Update-1.1.1.exe` updates an **already installed** NIPT-CBH 1.1.0 (source 4f41e33). It is not a new install: it never creates a database, never asks for admin credentials, and refuses to run when no installation is found.

## What changes
- APP_ADMIN, Settings: HIS Inbound, HIS Outbound, Laboratory, General, Security, Notifications and Report output.
  - Save validates, then becomes **Active at once**.
  - No draft, no second approver, no mandatory reason, no test queue.
  - The page says "บันทึกและใช้งานแล้ว (รุ่น N)".
  - The audit records actor, time, setting key, version and outcome. It holds no secret and no patient data.
- First Auto Scan enable: the page shows the scan scope first (look-back days, interval, folder, day folders, PET+OK pairs found) and asks for one confirmation. Nothing is imported before that.
- Unchanged: result certification, release, clinical signing and correction of certified results; production authorisation of HIS outbound; and every non-APP_ADMIN user, who is still refused.
- Migration `157_admin_direct_system_settings.sql` (forward-only) changes the activation guard only. It changes no data and no active setting, so **Auto Scan is not enabled by the Update**.

## Before updating
1. Close NIPT-CBH use and let queues drain (nothing in "running").
2. Run the Update as the same Windows account / elevation used for the original install.
3. The Update takes a pre-upgrade backup first.

## Install
Double-click `NIPT-CBH-Update-1.1.1.exe` (or `/SILENT`). The wizard shows the installed folder and updates it.
If the installed revision is not 4f41e33, the Update refuses with `UPGRADE_BASE_REVISION_MISMATCH` and **changes nothing**.

## Verify afterwards
1. `admin\nipt-admin.mjs health --root <install>` reports OK and version 1.1.1.
2. Sign in as APP_ADMIN, then Settings, HIS Inbound. Tick Auto Scan, press **บันทึกและใช้งาน**, confirm the scope, and the page reports Active. Reopen the page: it is still ticked. Untick, save, and it is off.
3. The HIS paths are unchanged (Settings, HIS paths).
4. Worker: within one interval the worker heartbeat is fresh. Diagnostics (psql, read-only):
   - `SELECT kind,state,count(*),min(created_at) FROM job_outbox GROUP BY 1,2 ORDER BY 1,2;`
   - `SELECT r.setting_key,r.version,r.state,r.value->>'enabled' AS enabled FROM settings_revision r JOIN setting_active a ON a.revision_id=r.id WHERE r.setting_key='his_inbound';`
5. A non-admin user (for example LAB_STAFF) is refused on Settings save.

## Rollback / recovery
- A failed upgrade rolls back automatically when the schema allows it.
- Once migration 157 has run, `rollback` is refused by design. Use `nipt-admin.mjs restore --backup <pre-upgrade backup>`; `nipt-admin.mjs backups` lists them. The backup holds the database and the app.
- If the Update is interrupted, run it again: it resumes from the last verified step.

## Known limits
- Not Authenticode-signed (no certificate). Windows SmartScreen may warn. Package integrity is Ed25519-verified by the engine.
- Bound to 1.1.0 (source 4f41e33, the delivered production installer). A server on any other revision (for example a Codex 1.2.x build) is refused with nothing changed. Check first, read-only: `Get-Content <root>\install-state.json` and read current.version / current.revision.
- Migration 157 must be carried by every later release; otherwise the engine reports the schema as newer than that release.
- The monitor symptoms (431 PET+OK pairs not in the waiting list, `QUEUE_STALE`, `WORKER_REPORTED_ERROR`) were not reproducible without hospital data. Use the SQL above on the server to confirm.
