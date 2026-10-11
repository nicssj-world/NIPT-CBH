# Subsequent implementation and acceptance

| Phase | Remaining work / external evidence |
| --- | --- |
| P2 / AL-2 | ANC + new Lab registration UI, five-category request, clinical rules, consent/paper paths, signing sessions, doctor/templates, approved PDF and ANC/Lab usability |
| P3 / AL-3 | Actual read-only CIFS/service identity/ACL, signed PET differential parity, reconnect/mount behavior, real inbound shadow with authorized test data |
| P4 / AL-4 | Lab worklists, labels/LN Halos at actual receipt, batch/task sheets, finalize/execution/reconciliation, QC1, repeat/redraw workflow and S2 receipt UI |
| P4b / AL-4b | Validated formula engine/goldens, pooling/DNB/sequencing, six controlled forms, exact 47-row HALOS export and witnessed physical↔barcode mapping/vendor import |
| P5 / AL-5 | Attempt-aware PDF import/link/review, QC acceptance, certification/release, revisions/void, ANC current result view |
| P5H / AL-8 | Historical evidence/cutoff eligibility/promotion and independent review; never send historical results to HIS |
| P6 / AL-6 | Actual RES/PDF receiver parity, approved naming/encoding/paths/ACK, per-transfer backup, retries/epoch/reconcile/revision rules; signed LAN test including redraw same LN |
| P7–P8 / AL-7 | Full security/performance/DR RTO/RPO, manual WCAG + NVDA ACR, usability ≥90%/zero critical errors/SUS≥70, training, pilot/cutover/clinical validation and formal release |

No authority is inferred from synthetic test success. Hospital paths, credentials and receiver expectations are not guessed or taken from legacy configuration. No clinical workflow or original document was changed to bypass a gate.
