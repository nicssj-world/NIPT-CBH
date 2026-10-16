# Combined Admin + Operational Owner Manual UAT

Environment: **TRAINING / LOCAL UAT — NOT FOR CLINICAL USE**. Open `https://127.0.0.1:19446/login` on this Windows machine. Certificate is local loopback; verify that exact address. Do not install a machine-wide trust certificate. Use fake records only.

Worktree: `D:\Claude workspace\NIPT-CBH-INTEGRATED-UAT`. Branch: `local/integrated-admin-operational-uat-20261017`. Docker project: `nipt-integrated-uat-20261017`. Database: `nipt_operational_integrated_uat`. Credentials: this worktree's ACL-restricted `.local/home-operational-uat/credentials.txt` (fresh independent passwords). Do not use the source preview's credentials or launcher.

Automated evidence is separate from this checklist. Owner records date, role, case/record ID, expected/observed result and evidence for each item below. Leave unchecked until personally tested; a skipped or HOLD step is not acceptance.

## Access and Admin

- [ ] Login as `uat.admin`, `uat.lab`, `uat.certifier`, `uat.clinical-approver`, `uat.auditor`, and `uat.anc`; sign out between identities. Confirm training banner and allowed navigation; rejected actions remain rejected server-side.
- [ ] Admin searches/paginates users and departments, creates a uniquely named test department and ordinary user, and edits the profile. Required fields, validation and unsaved-change protection behave clearly.
- [ ] Admin proposes role/scope/permission access. A distinct clinical approver checks it; same maker/checker and target-as-checker are denied. Login as the new ordinary user, complete mandatory password rotation, and confirm old password/session rejection.
- [ ] Change a normal user's access or disable it; existing sessions cease to work. Re-enable/unlock/reset through allowed actions; history remains visible. Referenced departments cannot have their code changed; deletion is unavailable.
- [ ] Sensitive grant/reset stays AwaitingEnrollment and reveals no credential to either Web actor. Installation owner verifies the target and uses `tools/admin-enroll.ts` according to `docs/admin-settings-operations.md`. Do not share another person's credential to bypass independent approval.
- [ ] First-install bootstrap is empty-install-only, creates distinct admin/checker and requires rotation. This populated training installation correctly refuses a second bootstrap; do not clear users to test it.

## Settings, Health and Audit

- [ ] Search/group Settings and inspect current Active version, author, effectiveness and lock explanation. Draft edits do not change runtime. Follow validation and independent approval where required; activation changes the appropriate runtime consumer.
- [ ] Change system name and verify Sidebar refresh; restore with a new governed revision. Test notification thresholds and local-only alert. Approved document identities/templates/formulas remain controlled.
- [ ] Inspect authenticated Health: Operational worker identity/freshness/lock, renderer, database mode, migration checksum, queue/reconciliation and storage. A minimal `/api/health` response alone is insufficient.
- [ ] Inspect read-only Audit filters/pagination and Bangkok timestamps. No password/hash/key/raw patient payload appears. Backup monitor accurately reports NOT CONFIGURED until an installation owner supplies a signed receipt/public key; no Web restore/delete authority exists.

## Operational workflow

- [ ] Registration → matching local PET/OK → Receive → LN Halos → 50×20mm label preview. Use `Home-UAT.ps1 -Action ListFixtures` and `-Action StagePET -FixtureId <ID>` only from this integrated worktree. Physical printer calibration remains a separate manual check.
- [ ] Batch placement, singleton/twin/recollection/re-library identities and POS/NEG/BLANK controls retain stable identifiers and history. Follow Task List 1–3, execution, second-person review and QC1.
- [ ] Pooling/QC2 → HALOS workbook/readback using simulated observations → DNB/QC3 → sequencing/QC4. Missing evidence remains HOLD. No real HALOS/device connection is configured.
- [ ] Save/resume Workbook values; export XLSX and six sheet PDFs through the native Excel bridge. Inspect control highlights at PC1/NC25/BLANK40, Thai text, A4 layout, approved F52 `(D54*F54)/D52`, D55 `F54-F52`, and D52 invalid-value guard. Approved Master must remain unchanged.
- [ ] Import local fake result PDFs → linkage → independent review → QC5 → certification/release. Verify S1 and recollection S2 retain correct current-round identity.
- [ ] Inspect local RES/PDF/backup/BOM-only OK output. `hisConfirmed=false` is expected; local publication does not mean HIS acknowledgement. Never enter hospital destinations.

## Persistence and closeout

- [ ] Run `pwsh -NoProfile -File tools/operational/Home-UAT.ps1 -Action Restart` here. Before/after case/batch/release/transfer counts match. Reopen prior user, Active Settings, case/workbook/result/export and authenticated Health.
- [ ] Record issues against the integrated candidate, including reproduction and role. Do not reduce clinical/QC/release/security/owner locks to complete a step.
- [ ] Owner signs off manual local UAT separately from hospital, clinical, DCC, HIS, equipment or Production acceptance.

Lifecycle: `Home-UAT.ps1 -Action Start|Health|Restart|Logs|Stop`. Stop preserves all data and volumes. Do not run `down -v`, delete data, or operate source preview projects. Existing automated positive-journey fixtures are retained; do not rerun its initial seeding against populated data.
