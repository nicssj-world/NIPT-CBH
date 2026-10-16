# Admin operations — local integration candidate

This extends the merged Main baseline. It does not install or activate a hospital runtime. Existing Operational/HIS/clinical guards remain in force.

## Users, roles and departments

`ตั้งค่าระบบ → จัดการผู้ใช้` supports search, active/disabled/locked and role filters, pagination, profile edits, department selection, disable, unlock, password recovery, and read-only change history. All nine existing roles remain unchanged. Department is personnel metadata; case visibility still uses independently approved `user_unit_scope` and existing permissions. There is no user deletion or public registration.

APP_ADMIN creates users with no roles and mandatory password rotation. A normal role/scope/permission request goes through an independent CLINICAL_APPROVER, distinct from maker AND target. Version checks reject concurrent/stale changes; activation revokes existing sessions. Future sensitive assignments also prevent unilateral password reset.

Sensitive roles are APP_ADMIN, CLINICAL_APPROVER, LAB_CERTIFIER, IT_OPERATOR and HISTORICAL_VERIFIER. Approval for such access, and all independent recovery requests, enters `AwaitingEnrollment`. Web invalidates the target's old password/sessions but returns no replacement credential. New sensitive roles are **not active** until the installation owner completes target-only enrollment. The maker and checker must never receive usable target credentials. This boundary prevents one person controlling both approval identities through password reset.

Use an installation-owner DB connection and a protected launch context after verifying the target's identity outside Web. Set `NIPT_TARGET_ENROLLMENT_CONFIRMED=yes`, `NIPT_ENROLLMENT_USERNAME` and `NIPT_ENROLLMENT_PASSWORD`, then run:

```powershell
npx tsx tools/admin-enroll.ts <approved-request-uuid>
```

The password is not a CLI argument, output, source constant or audit field. Supply it through a protected process context directly for the verified target; do not put a real value into a checked-in script or shell history. The tool rechecks owner authority, maker/checker authority, exact username, version and approval; it applies access and requires target password rotation. No Web endpoint can finalize enrollment, and app_rw cannot transition the DB request to Approved. Busy signing sessions reject administration/password changes safely; retry the entire action after signing ends.

For a **fresh empty installation only**, the installation owner supplies two distinct verified identities using `NIPT_INITIAL_ADMIN_USERNAME`, `NIPT_INITIAL_ADMIN_NAME`, `NIPT_INITIAL_ADMIN_PASSWORD` and corresponding `NIPT_INITIAL_CHECKER_*` variables in a protected launch context. Set `NIPT_ADMIN_BOOTSTRAP=EMPTY_INSTALLATION` and run `npx tsx tools/admin-bootstrap.ts`. Both accounts must rotate passwords. The tool refuses populated installs and `synthetic.*` bootstrap names. This is provisioning, not public registration or a replacement installer.

Normal accounts can be reset in Browser to a policy-compliant temporary password supplied securely by the admin; all sessions are revoked and rotation is mandatory. Users change their own password at `/password`. Wrong current-password attempts persist; five attempts lock and revoke sessions. Argon2id, 10–128 character policy, 30-minute idle / 8-hour absolute lifetime and 15-minute lockout remain unchanged.

Departments support create, rename, unused-code correction, search, pagination and Active/Inactive. All FK references and pending/immutable scope requests block code changes. Existing historical references/scopes remain when Inactive; new assignments require Active. No department deletion is offered.

## Settings, audit and health

Settings groups and search reuse the existing catalog and editor. Active/Draft/Pending versions, author identity, planned effective time and actual activation audit time are shown. General and notification revisions use Draft → Validate → Activate; regulated settings retain independent approval and existing Worker tests. Rollback creates a new version requiring the original validation/approval process.

Active `general.systemName` changes Sidebar identity and refreshes the shell; controlled document identity is preserved. Active notification thresholds feed runtime health. Unsupported global request/consent/doctor-version metadata is read-only and cannot be proposed/activated through API. Laboratory template/formula labels are controlled **batch metadata**, not template/formula selectors; arbitrary new labels are rejected. Storage retention is installation-owned and cannot be activated from Web. No clinical/HIS HOLD or literal lock is relaxed.

Audit Log requires server `audit.read`; it supports actor/name/username, event/outcome filters, pagination, target IDs and Bangkok time. Only allowlisted scalar details are returned; passwords, tokens, keys, patient payloads and full audit payload/hash fields are omitted. Existing chain rows are never changed/deleted.

Health selects the actual `synthetic-worker` or `operational-worker`, checks recent heartbeat **and** the process singleton lock, runtime/DB mode, quarantine and migration inventory. Inbound enablement is separate from process liveness and last job success. Renderer health is a bounded authenticated local/service probe. Queue backlog/age, scan failure, transfer retry/reconciliation and P6 worker error alerts are in-app; no external sender is installed. A clearly labelled local Browser alert test does not create a real incident. File Store capacity is measured with statfs where available; the fixed 1 GiB warning is not hospital quota acceptance.

## Backup / Restore monitoring

Operational `backup.mjs` and `restore.mjs` reuse the existing encrypted snapshot/restore path. An optional signed completion receipt records actual successful CLI results; it does not interpret file existence as success. Setup is installation-owned:

- Operator process: `NIPT_OPERATIONS_STATUS_FILE`, `NIPT_OPERATIONS_STATUS_SIGNING_KEY_FILE` (Ed25519 private key), existing backup policy/encryption settings.
- Web process: the read-only status file and `NIPT_OPERATIONS_STATUS_PUBLIC_KEY_FILE` only. Do **not** provision the private signing or backup encryption key to Web.
- Provision the public key through a trusted installation channel. Protect private-key and receipt-write ACLs for the operator; grant Web read access only. Optional `NIPT_BACKUP_WARNING_HOURS` defaults to 24 and is read-only installation configuration.

Web verifies signature and exact source-database fingerprint, reports last successful creation, age, and last verified restore. `CREATION_VERIFIED` is distinct from `RESTORE_VERIFIED`; restore verification does not prove Hospital RPO/RTO or Owner acceptance. Missing setup, bad signature, wrong target or unreadable evidence is NOT CONFIGURED / NOT VERIFIED. Receipt publishing failure is separately reported in CLI `monitoring.status`; it does not relabel a completed encrypted backup as failed. Existing restore quarantine/activation remains operator-only, with no Web restore/delete/key controls.

## Integration with Home Operational Preview

Stop for Owner Review. No integration is performed here. After separate approval, inspect the then-current Main and Preview branch/dirty state, compare changes to protected layout, Settings, Health, auth/session and CSS, reconcile conflicts in a new integration worktree, and test the combined exact HEAD. Apply only new forward migrations through the approved target process after checking the live ledger and taking verified backup evidence. Do not copy this test cluster, credentials, keys or signed receipts into Preview. Preview service/launcher/container/volume changes and Windows Installer work remain separately authorized tasks.
