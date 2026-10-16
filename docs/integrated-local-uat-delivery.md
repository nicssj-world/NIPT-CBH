# Integrated Admin + Operational Local UAT delivery

This is the combined local candidate for Owner Manual UAT, not hospital/clinical/Production acceptance. The final status is authoritative only in `.local/integration/delivery.json`, which binds current Git HEAD, source tree, migration inventory, source verification, combined browser/operational evidence, isolation and restart checks. Read this document with that receipt.

## Candidate and access

- Worktree: `D:\Claude workspace\NIPT-CBH-INTEGRATED-UAT`
- Branch: `local/integrated-admin-operational-uat-20261017`
- Sources retained as ancestors: Admin `0fd4a896964d4791eed213429e84f56feef017c0`; Operational `f84313a0965d191e952e3a4ee98750bc6ec2cad1`.
- Common baseline: `ea48e624c21cb7fef89e89bc4c02241300a3dd02`.
- Browser: `https://127.0.0.1:19446/login`. Local certificate and TRAINING / LOCAL UAT banner.
- Admin: `uat.admin`. Fresh independent passwords for all six role accounts are in this worktree's `.local/home-operational-uat/credentials.txt`, ACL-restricted to current user/Administrators/SYSTEM. Passwords are excluded from Git, images and delivery reports.

## Isolation and compatibility

Project `nipt-integrated-uat-20261017` uses new project-scoped `database` and `caddy` volumes. Its database is `nipt_operational_integrated_uat`, ingress `127.0.0.1:19447`; Web ingress is `127.0.0.1:19446`. All file-store, simulator, credentials, Master copy and native Excel spool bind paths resolve within this new worktree. Internal data/render/proxy networks and NAT-disabled ingress preserve the source network boundary. No existing preview database, container, volume or test record is reused or changed.

Git integration was conflict-free; both source histories and their code are retained. Candidate changes isolate the existing Home launcher/compose/provisioner/journey targets. Docker Web explicitly includes migration SQL: the authenticated Admin Health consumer needs runtime files for ledger/checksum comparison. No clinical/QC/release/security/owner guard was altered.

Docker's existing default address pools were exhausted. Only this candidate's two empty, labelled partially created networks were removed; all five new networks use explicit non-overlapping `/28` subnets within `10.237.17.0/24`, checked against current Docker IPAM and Windows routes. No global Docker configuration, existing network, container or volume was pruned or restarted. The previous source-verification candidate was invalidated and its specifically verified own test process tree stopped before a final fresh run.

New migrations are exactly `096_admin_settings.sql`, `097_admin_recovery.sql`, `098_admin_target_enrollment.sql`; no operational-side migration collision and no prior migration/checksum tool change. Fresh installs and populated-095 upgrades, reapply, credential/role/scope/audit/settings/case preservation and empty-install bootstrap are exercised in tests. The persistent training installation uses the existing six-role UAT provisioner, not public registration or a Web bootstrap bypass; production first-install bootstrap/enrollment remains installation-owner-only.

## Verification evidence

`tools/integrated-final-verify.ts` records exact-HEAD typegen/typecheck/lint/source guard/diff/build/full regression/deployment contracts and disposable native Admin browser/security/worker/backup smoke tests under `.local/integrated-final-*`. This source-verification PASS alone does not assert combined preview readiness.

Persistent combined browser evidence: `.local/integrated-admin/evidence.json`, including role login, normal user lifecycle, password rotation/revocation, maker/checker, RBAC, Active Settings consumption, authenticated Health, responsive accessibility/screenshots. Operational evidence: `.local/home-operational-uat/positive-journey/evidence.json`, including Registration/Receive/LN Halos/labels, 48-slot controls, QC1–QC5, pooling/DNB/sequencing simulated HALOS readback, workbook binding save/resume/XLSX/native Excel PDFs, result release and local P6 RES/PDF/backup/BOM-only OK with HIS unconfirmed. Restart/isolation/native Excel checks and Master before/after hash are recorded in the final receipt's referenced artifacts. Skipped suites are reported separately from passed tests.

Approved Combined Master SHA-256: `0f94efbc240b9a38ff9be77bf0c8d92c09d82fa2fe2427b9d274cc739e5607a6`. It is read only; generated files may carry approved control highlighting but never rewrite the Master.

## Remaining boundaries

Owner Manual UAT checklist: [INTEGRATED-OWNER-UAT-CHECKLIST.md](INTEGRATED-OWNER-UAT-CHECKLIST.md). Existing Admin inventory/limitations: [admin-settings-delivery.md](admin-settings-delivery.md). The 102-item inventory retains Missing/Partial/HOLD/installation-owned items; integration does not expand approved scope.

Sensitive credential enrollment and service identity/ACLs remain installation-owned. Persistent preview backup monitoring reports NOT CONFIGURED until signed status/public-key provisioning; disposable CLI backup/restore smoke does not prove a populated hospital restore drill. Physical printers, actual HALOS/instruments, hospital LAN/UNC/SMB, HIS acknowledgement, clinical/DCC/Owner acceptance remain NOT VERIFIED. No external notification provider was added. Remote CI NOT RUN; no push, Main merge, Production deployment or Windows installer. The unchanged development-toolchain audit findings reported in Admin delivery remain disclosed; runtime dependency audit was clean at Admin source verification.

The integrated environment is left running only if all required local gates pass. Later edits invalidate exact-HEAD evidence and require affected verification. Do not rerun initial positive-journey seeding over retained data. Stop/restart only with this worktree's launcher.
