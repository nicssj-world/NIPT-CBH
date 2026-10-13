# P8 local technical preparation

Authority: Owner execution order 2026-10-14; immutable Implementation Plan v6.2.1 SHA256 `261acf8cebec7915d255abaccf02e2bb55d76de0a59b26d9c7abc7b0c7703c2e`, §§14.3–14.8, 15.2–15.3, OD-26(c). The session authorizes synthetic technical preparation only, not AL-7 acceptance or a clinical pilot. P7 PR #8 merged as `7c63a2a6b557d4cac9e325a22f50319ee9241e7d` after both exact-head CI runs succeeded. Post-merge CI is tracked separately in delivery evidence.

## Constraints

- Work only in `D:\Claude workspace\NIPT-CBH-P8`, branch `feat/p8-technical-readiness`; local commits only. No P8 push/PR/merge.
- Preserve Local/on-premises architecture, existing clinical/lab workflows, applied migrations, owner locks and all clinical HOLD boundaries.
- Disposable synthetic databases, own Compose project/volumes/runtime, loopback ingress. Do not alter existing worktrees, databases or clinical systems.
- Reuse P7's 68/68 standalone browser, native safety, PDF/label, 113-table recovery and bounded performance evidence. Add tests for deployment changes and new operational risks only; a final packaged candidate regression is justified only by packaging changes.
- No fabricated publisher, acceptance, staff signatures or device evidence. Actual cutoff/anchor, hospital RPO/RTO, IT endpoints, operational acceptance and AL-7 remain pending.

## Execution ledger

| Task | Workstreams | Deliverable and verification | State |
|---|---|---|---|
|1|A/F|Harden signed installation, explicit runtime/project targeting, upgrade/rollback, image/source/migration provenance; negative orchestration tests; real isolated bundle rehearsal|IN PROGRESS|
|2|B/D|Native synthetic cutoff/frozen in-flight manifest, pre/at/post boundary, bulk import, duplicate/identity/second-person/partial confirmation, rollback and outbound barrier rehearsal; retained evidence|PENDING|
|3|A/B/C/F|Operator health/smoke, startup/restart/failure recovery, migration drift, worker durable job recovery, least privilege, backup/restore operational procedure and measured timings|PENDING|
|4|E|Prepare staff accounts/cases and unsigned acceptance records from P7 checklist; physical validation remains pending|PENDING|
|5|A–F|Installation/operations/DR/cutover runbooks, existing gap register updates, focused validation, independent review, local commits and delivery report|PENDING|

Tasks 1/2/3 have separate code ownership: deployment scripts/bundle/Dockerfile; cutover rehearsal tool/tests; health/recovery tool/tests. The controller owns runbooks, integration/rehearsal and final evidence. Shared migration and workflow interfaces are read-only. No original plan content is redistributed.

Ruling: plan P8 is Pilot/Go-live gated by AL-7; this session's P8-A–F preparation is explicitly permitted under synthetic HOLD. A failed/blocked action is recorded while independent safe work continues.
