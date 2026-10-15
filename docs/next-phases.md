# Subsequent implementation and acceptance

| Phase | Remaining work / external evidence |
| --- | --- |
| P2 / full clinical AL-2 | Restricted synthetic implementation is documented in p2-delivery.md; remaining evidence is approved clinical policy/consent, DPO/DCC controlled templates/signatures/retention, full manual ACR and actual ANC/Lab usability. See p2-governance.md. |
| P3 / AL-3 | Actual read-only CIFS/service identity/ACL, signed PET differential parity, reconnect/mount behavior, real inbound shadow with authorized test data |
| P4 / AL-4 | Synthetic build delivered on `feat/p4-lab-workflow-synthetic` (see p4-synthetic-delivery.md). Remaining: Owner decisions OD-01/03/08/16/31/33/34/36, signed F2/F3 field inventory and controlled form codes, physical label printer Q-I7, downtime recovery §12.25, post-Completed correction, Lab usability/UAT and AL-4 clinical/lab acceptance |
| P4b / AL-4b | Synthetic Pooling/QC2/F4 and immutable HOLD snapshots delivered (p4b-pooling-delivery.md); HALOS pure contract preserved. DNB/QC3, sequencing/QC4, F5 and exact handoff simulation added (p4b-sequencing-delivery.md). Remaining: OD-28–36, signed inventory/goldens, operational acceptance, real accepted-Pool HALOS adapter/vendor import |
| P5 / AL-5 | Restricted synthetic build delivered (p5-result-management-delivery.md): NIPTY folder intake, template-aware parser, two-person round/attempt linkage, RG/RN in-transaction gates, review, certification attempt ending in RELEASE HOLD, revision/void of unreleased versions, scoped ANC viewer. Remaining: OD-07 PIC/template verification with hospital synthetic PDFs, OD-05 confirmation method, OD-04 Clinical Governance sign-off, OD-09/OD-17, AL-5 sign-off and a reviewed migration replacing `p5_release_authorized()`; E2E with P4b FinalQcAccepted/Analysis completion (AT-RES-PDF-01); released-version Revision/Void/Reissue and ANC display of released PDFs; A14/A23 implemented per Owner decision; P7 adds A19 synthetic filters/CSV, A21 append-only diagnostics and A22 read-only maintenance; clinical adoption/automatic repair remain HOLD (docs/p7/gap-register.md) |
| P5H / AL-8 | Restricted synthetic build delivered (p5h-historical-backfill-foundation.md): pure rules plus integrated bulk import (table + PDF/ZIP upload, worker staging, per-row fixes, second-person batch confirmation, guarded promotion; migration 070). Everything stays Fail Closed until the Owner approves OD-18 Anchor policy, `go_live_cutoff` and the OD-19/20/21/23/26/27 and Q-G7 decisions; no historical HIS path exists |
| P6 / AL-6 | Actual RES/PDF receiver parity, approved naming/encoding/paths/ACK, per-transfer backup, retries/epoch/reconcile/revision rules; signed LAN test including redraw same LN |
| P7–P8 / AL-7 | Full security/performance/DR RTO/RPO, manual WCAG + NVDA ACR, usability ≥90%/zero critical errors/SUS≥70, training, pilot/cutover/clinical validation and formal release |

No authority is inferred from synthetic test success. Hospital paths, credentials and receiver expectations are not guessed or taken from legacy configuration. No clinical workflow or original document was changed to bypass a gate.

Owner full-legacy parity lock applies to every phase. Track every archive capability and unresolved conflict in [legacy-functional-parity-matrix.md](legacy-functional-parity-matrix.md); phase gaps require an assigned owner and acceptance gate. P4b/P5 migration and identity boundaries: [p4b-p5-integration-contract.md](p4b-p5-integration-contract.md). No NIPTY runtime is retained.

## P7 technical validation addendum — 2026-10-13

P6/P5H PR #7 merged as ad66ab401b0565ed0bd88fb73096ef6f0456a1ef with required checks and post-merge CI passing. Local P7 work on feat/p7-final-validation adds clinical state/currentness hardening, result parity/diagnostics and coherent backup/restore validation. See [delivery](p7/delivery.md), [gap register](p7/gap-register.md) and [prepared Staff UAT checklist](p7/acceptance-checklist.md). P7 is not an AL-7 sign-off or P8 authorization; no P7 push/PR/merge or deployment is implied.

## P8 technical preparation continuation — 2026-10-14

P7 PR #8 merged as 7c63a2a6b557d4cac9e325a22f50319ee9241e7d after both exact-head CI checks; post-merge CI38440548956 succeeded. Owner authorizes P8 local branch/commits and isolated synthetic preparation only. [P8 delivery](p8/delivery.md), [gap register](p8/gap-register.md) and [operations runbook](p8/installation-operations.md) record signed installation/upgrade/rollback, recovery, cutover and prepared staff UAT. OD-26(c) is the chosen design baseline; actual cutoff/anchor/in-flight approval and AL-7 remain HOLD. No P8 push/PR/merge, clinical pilot or Production configuration is authorized.
