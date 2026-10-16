# Admin & Settings completion

Source: `ea48e624c21cb7fef89e89bc4c02241300a3dd02`, branch `feat/admin-settings-completion`.
Owner request in this session authorizes audit, implementation, forward migration, verification and one final local commit; no push, merge, deployment, installer or Preview changes.

Design: extend existing PostgreSQL users/scopes/permissions, Argon2id, session, audit chain and Settings revisions. Use `user.manage` write (APP_ADMIN) for proposals and `user.manage` approve (CLINICAL_APPROVER) for access assignment. Require checker distinct from maker AND target. Sensitive roles/recovery enter AwaitingEnrollment; only an installation owner can finalize target-only credentials outside Web, after identity confirmation. Neither maker nor checker receives a target credential. No new roles. New users have no access until approved/enrolled as required. All role/scope/permission replacements revoke sessions; reset/disable do likewise. Serialize administration, use after-lock current-clock authorization, NOWAIT session reservations and version checks. Bootstrap is operator-only, empty-install-only, with protected password input, never seeded synthetic permanent credentials.

- [x] Audit all 102 matrix entries against current source/schema/runtime; document original external Plan re-verification limit.
- [x] Add forward migrations 096–098 for user/unit versions, password rotation/last login, immutable access/recovery requests and operator-only sensitive enrollment.
- [x] Add tested user/unit/access/password services and server-authorized, CSRF-checked APIs; recheck actor session/role after lock.
- [x] Add Thai browser workflows, details/history, pagination/search/filter, change-password and initial provisioning/target enrollment CLIs.
- [x] Correct runtime health identity, active alert thresholds, database/quarantine/migration checks, renderer probe, storage measurement and signed operator backup receipt monitoring.
- [x] Consume active system name in shell; group/search Settings and label unsupported/metadata-only fields; protect them on server.
- [x] Add read-only redacted audit browser and local-only alert test.
- [x] Verify fresh/095 upgrade, negative RBAC/CSRF, concurrent/queued expiry/signing conflicts, password/session revocation, settings lifecycle, HIS maker-checker and actual Synthetic/Operational workers in disposable cluster.
- Final exact-HEAD Typecheck/Lint/Guard/Build, standard full regression, deployment contracts and Browser/native smoke are executed by `tools/admin-final-verify.ts`; its generated receipt supplies the final closeout status.

Independent blockers require recording and continuation, not invented owner decisions. Existing 087+ operational authority is an existing baseline; this change must neither remove nor broaden it. No destructive backup controls or external notification provider. Logo remains controlled installation asset; no upload needed for administrative UAT.
