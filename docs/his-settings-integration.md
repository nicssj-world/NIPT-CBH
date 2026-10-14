# HIS Settings functional integration — synthetic/authorized test scope

Authority: Owner task “Close HIS Integration Functional Gaps Before Final Package”, 2026-10-14. Existing unified application and completed legacy audit remain authoritative. This work closes configuration/connection gaps only; it does not repeat P1–P8 audits or grant clinical authority. Baseline is main `7c63a2a`; isolated branch `integ/his-settings-functional` at `D:\Claude workspace\NIPT-CBH-HIS-INTEG`. P8/Windows Packaging checkout is untouched. No push, merge, deployment or hospital-share access is included.

## Reused behavior and actual changes

- Existing Settings schemas/forms, immutable revisions, Maker-Checker, RBAC and audit chain are retained. HIS draft validation now queues a Worker test; a successful, revision-correlated Worker receipt must be recorded before independent approval/activation. Failed tests remain Draft and can be queued again. Tests of the active revision are separate from activation.
- Existing PET/OK discovery, Bangkok daily folders, CP874 parser, NIPT section/test rules, synthetic identity restrictions, file hashing and intake processing are reused. Worker resolves the active Base Path on each job. The configured base is the parent of YYYYMMDD folders. Inbound share operations only inspect/list/read; no create/write/rename/delete is available through this source.
- Existing P6 serializer, frozen plans, journal, exclusive publication, PDF → RES → Backup verification → BOM-only OK, retry/backoff, recovery and reconciliation remain the transfer engine for configured authorized test destinations. No legacy transfer application is launched. Physical destinations are mapped into this existing transport.
- Settings adds RES/OK destination, PDF/CFS destination, transfer Backup Path, Credential Reference, initial retry delay and confirmation timeout. Existing result style/retry limit now enter Settings-bound frozen plans. Old Settings revisions remain parseable with safe defaults.
- The Worker checks both active revision and complete configuration fingerprint. Changing Settings cancels old work before delivery; delivered/ambiguous work remains reconciliation. Final OK publication shares the same advisory transaction lock as Settings activation, without granting the Worker configuration UPDATE privileges.
- Settings displays Worker tests, transfer state, version, retry attempt/backoff, sanitized access errors and event history. Retry permission is independently checked against `his.retry`; it cannot bypass backoff or replay terminal/ambiguous deliveries.
- Migration `083_his_source_identity.sql` adds source identity to inbound source/waiting keys. Same relative name/size/mtime at another physical base cannot suppress a read. Existing relative-path validation and global byte deduplication remain intact; no applied migration is edited.

## Deployment-owned authorization for connection testing

`NIPT_MODE=synthetic` is mandatory. The Worker receives `NIPT_HIS_SHARE_POLICY_FILE`, an absolute path to an IT-owned JSON file. Web Settings cannot edit it. Provision this file outside the installer/media/source and prevent the Worker account from modifying it. Prefer narrow, disjoint purpose-specific roots. Overlapping grants for a requested purpose are refused.

```json
{
  "version": 1,
  "grants": [
    {
      "root": "<ABSOLUTE AUTHORIZED INBOUND TEST ROOT>",
      "purposes": ["INBOUND"],
      "serviceAccount": "<DOMAIN\\service-account>",
      "secretRef": null
    },
    {
      "root": "<ABSOLUTE AUTHORIZED OUTBOUND TEST ROOT>",
      "purposes": ["OUTBOUND"],
      "serviceAccount": "<DOMAIN\\service-account>",
      "secretRef": null
    }
  ]
}
```

Each allowed root must already contain an IT-provisioned, regular single-link `.nipt-authorized-test-root` file with content `NIPT_AUTHORIZED_SYNTHETIC_SHARE_V1`. RES/PDF/Backup directories must already exist and be disjoint. The Worker never creates the authorization marker on a configured share. All operations recheck policy, account, root/links and filesystem access. Windows identity uses `whoami` (domain qualified); Unix uses the OS username. Local and UNC paths use the host-native filesystem; traversal, device paths, ADS, symlinks/junctions, foreign hardlinks and overlapping destinations are refused.

`secretRef` is a UUID bound in the deployment policy to a credential provisioned by IT for the Worker service account. It must match the active Settings reference exactly. OS/SMB service authentication is provisioned outside the application; this change does not impersonate users, run `net use`, decrypt a password into logs or change Windows Credential Manager. Local fixtures use null. A UUID alone does not prove successful authentication: the real Worker performs the file access checks.

Inbound Test Connection needs a regular synthetic PET/OK pair and a successfully parsed sample; merely listing a directory is insufficient to validate a revision. Outbound Test Connection creates uniquely named synthetic probe artifacts using the existing P6 serializer/publication code and verifies Backup before OK. These probes are recorded as Settings test receipts/audit rather than clinical transfer rows; preserve test-share artifacts for review. Enabling configuration/testing does not authorize patient intake or clinical result publication.

## Use and reproducible verification

1. Provision an isolated test root, service account/ACL, policy file and synthetic PET/OK fixtures. Enable `NIPT_P6_SANDBOX_ENABLED=yes` for outbound synthetic tests. Start the existing Worker with the policy path.
2. In Settings save an HIS draft, select Test Draft, wait for the Worker report, then record its successful result. A different authorized checker approves and activates it. Test Connection for the active revision does not alter clinical authority.
3. Existing fixture tooling accepts `enroll-active <synthetic-index> <SYNTHETIC-sandbox-id>` to bind a deterministic synthetic fixture to active outbound settings before the existing journal reservation. Enrollment still requires fixture-writer privileges, unavailable to web and Worker roles. Ordinary `enroll` remains local simulator-only for old contract tests. No P5 release or patient record is converted into a fixture.
4. The existing Worker consumes the journal. Inspect status/history in Settings. Retry queues the existing journal worker and respects its original sequence, frozen bytes, gates and backoff.

Focused regression tests: `tests/unit/his-paths.test.ts`, `tests/db/his-settings.test.ts`, plus existing P3/P6 contracts and workflow tests. They cover path policy, actual Windows file ACL denial/restoration, junction/hardlink refusal, invalid sample rejection, Save/Worker Validate/Approve/Activate, source change/deduplication, stale version rejection, synthetic outputs/Backup, retry/recovery and clinical/historical barriers.

Native harness (requires already installed PostgreSQL binaries; creates its own isolated loopback cluster and database):

```powershell
$env:NIPT_HIS_TEST_PG_BIN = '<existing PostgreSQL bin directory>'
# Optional: after building, exercise compiled Next routes instead of development routes.
$env:NIPT_HIS_TEST_BUILT_WEB = 'yes'
npx tsx tools/his/verify-native.ts
```

The harness uses separate `app_rw`/`worker_rw` logins, actual web/Worker processes, browser login/Settings forms, API Maker-Checker actions, real Worker restart, changing destinations, transfer status/history and axe. It preserves logs/screenshots/evidence under `.local/his-native-*` and shuts down only its own processes/database. It never loads an existing `.env` or connects to an existing database/share. Fresh evidence is listed in the delivery report.

## Clinical separation and external acceptance

`p5_release_authorized()` remains false, Clinical Publisher remains disabled, and actual P5 release adaptation remains HOLD. Historical origins are rejected by existing queue/publication barriers. `hisConfirmed` stays false: a file, OK, pickup or synthetic confirmation does not mean HIS confirmation. Notice/round-2 date/clinical-template/evidence decisions remain governed by existing boundaries.

Hospital LAN Acceptance = **NOT RUN**. UNC/SMB endpoint acceptance = **NOT RUN**. Tests use isolated local Windows directories, not a hospital network share. IT must still accept the actual OS service identity, credential provisioning/reconnect, ACLs, UNC paths, exclusive-publication/durability semantics and restart behavior on an explicitly authorized test share. Hospital Production Integration is not claimed. Hostile concurrent filesystem namespace mutation is outside the local test guarantee; IT must prevent it with ACLs. Clinical acceptance is independent of connection acceptance.

## Windows Offline Installer impact

No installer or Packaging checkout is changed. After separately approved integration, rebuild/sign the installer from the integrated source, include migration083 and reviewed P6 fixture-reader grants, and rerun install/upgrade/rollback/smoke checks. No new runtime npm dependency is added. Preserve policy/keys outside media, set the policy environment for the Worker service, and run under the matching least-privilege account. No production path or credential is embedded in a default.

The installer must not seed external-share authorization or enable Clinical Publisher. Existing packages/installers cannot acquire this behavior without a rebuild. Transfer Backup Path verification is exercised here; full disaster-recovery/archive coverage for externally stored share artifacts and host SMB behavior requires separate packaging/IT acceptance. Compilation in a worktree with linked dependencies does not certify a standalone offline package. Installer readiness and integration-code readiness are separate results.
