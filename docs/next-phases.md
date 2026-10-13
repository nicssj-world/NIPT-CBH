# Subsequent implementation and acceptance

| Phase | Remaining work / external evidence |
| --- | --- |
| P2 / full clinical AL-2 | Restricted synthetic implementation is documented in p2-delivery.md; remaining evidence is approved clinical policy/consent, DPO/DCC controlled templates/signatures/retention, full manual ACR and actual ANC/Lab usability. See p2-governance.md. |
| P3 / AL-3 | Actual read-only CIFS/service identity/ACL, signed PET differential parity, reconnect/mount behavior, real inbound shadow with authorized test data |
| P4 / AL-4 | Synthetic build delivered on `feat/p4-lab-workflow-synthetic` (see p4-synthetic-delivery.md). Remaining: Owner decisions OD-01/03/08/16/31/33/34/36, signed F2/F3 field inventory and controlled form codes, physical label printer Q-I7, downtime recovery §12.25, post-Completed correction, Lab usability/UAT and AL-4 clinical/lab acceptance |
| P4b / AL-4b | Synthetic Pooling/QC2/F4 and immutable HOLD snapshots delivered (p4b-pooling-delivery.md); HALOS pure contract preserved. DNB/QC3, sequencing/QC4, F5 and exact handoff simulation added (p4b-sequencing-delivery.md). Remaining: OD-28–36, signed inventory/goldens, operational acceptance, real accepted-Pool HALOS adapter/vendor import |
| P5 / AL-5 | Restricted synthetic build delivered (p5-result-management-delivery.md): NIPTY folder intake, template-aware parser, two-person round/attempt linkage, RG/RN in-transaction gates, review, certification attempt ending in RELEASE HOLD, revision/void of unreleased versions, scoped ANC viewer. Remaining: OD-07 PIC/template verification with hospital synthetic PDFs, OD-05 confirmation method, OD-04 Clinical Governance sign-off, OD-09/OD-17, AL-5 sign-off and a reviewed migration replacing `p5_release_authorized()`; E2E with P4b FinalQcAccepted/Analysis completion (AT-RES-PDF-01); released-version Revision/Void/Reissue and ANC display of released PDFs; A14/A23 implemented per Owner decision; A19/A21/A22 remain for P7/P5H |
| P5H / AL-8 | Historical evidence/cutoff eligibility/promotion and independent review; never send historical results to HIS |
| P6 / AL-6 | Actual RES/PDF receiver parity, approved naming/encoding/paths/ACK, per-transfer backup, retries/epoch/reconcile/revision rules; signed LAN test including redraw same LN |
| P7–P8 / AL-7 | Full security/performance/DR RTO/RPO, manual WCAG + NVDA ACR, usability ≥90%/zero critical errors/SUS≥70, training, pilot/cutover/clinical validation and formal release |

No authority is inferred from synthetic test success. Hospital paths, credentials and receiver expectations are not guessed or taken from legacy configuration. No clinical workflow or original document was changed to bypass a gate.

Owner full-legacy parity lock applies to every phase. Track every archive capability and unresolved conflict in [legacy-functional-parity-matrix.md](legacy-functional-parity-matrix.md); phase gaps require an assigned owner and acceptance gate. P4b/P5 migration and identity boundaries: [p4b-p5-integration-contract.md](p4b-p5-integration-contract.md). No NIPTY runtime is retained.
