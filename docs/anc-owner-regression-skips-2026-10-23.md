# ANC final regression skips — 2026-10-23

SKIP is not PASS. Raw full run at `ea12d61`:2378 PASS /1 obsolete SCA assertion FAIL /59 SKIP. The obsolete assertion was corrected to the latest Owner decision; the entire four-test file reran PASS (plus three age/SCA tests). Reconciled unique coverage: **2379 PASS /0 unresolved FAIL /59 SKIP**, without adding overlapping focused tests or rerunning unaffected full-suite tests. Raw and reconciled JSON/logs remain in `.local/anc-owner-closeout-20261023/`. No application behavior changed after the full run.

| File | SKIP count | Condition and remaining risk |
|---|---:|---|
| `tests/contracts/lab-repeat-native.test.ts` | 1 | NIPT_TEST_DATABASE_URL absent; disposable-native grant/race/upgrade coverage not run in this full suite. P2 and P2-P3 ran separately:2 PASS; other historical native evidence is labelled historical. |
| `tests/contracts/ln-integrity-native.test.ts` | 1 | NIPT_TEST_DATABASE_URL absent; disposable-native grant/race/upgrade coverage not run in this full suite. P2 and P2-P3 ran separately:2 PASS; other historical native evidence is labelled historical. |
| `tests/contracts/native.test.ts` | 2 | NIPT_TEST_DATABASE_URL absent; disposable-native grant/race/upgrade coverage not run in this full suite. P2 and P2-P3 ran separately:2 PASS; other historical native evidence is labelled historical. |
| `tests/contracts/p2-native.test.ts` | 1 | NIPT_TEST_DATABASE_URL absent; disposable-native grant/race/upgrade coverage not run in this full suite. P2 and P2-P3 ran separately:2 PASS; other historical native evidence is labelled historical. |
| `tests/contracts/p2-p3-native.test.ts` | 1 | NIPT_TEST_DATABASE_URL absent; disposable-native grant/race/upgrade coverage not run in this full suite. P2 and P2-P3 ran separately:2 PASS; other historical native evidence is labelled historical. |
| `tests/contracts/p3-legacy-differential.test.ts` | 1 | Explicit legacy parser/sample fixture path absent; differential/vendor sample coverage remains unrun. |
| `tests/contracts/p3-native.test.ts` | 1 | NIPT_TEST_DATABASE_URL absent; disposable-native grant/race/upgrade coverage not run in this full suite. P2 and P2-P3 ran separately:2 PASS; other historical native evidence is labelled historical. |
| `tests/contracts/p4-native.test.ts` | 1 | NIPT_TEST_DATABASE_URL absent; disposable-native grant/race/upgrade coverage not run in this full suite. P2 and P2-P3 ran separately:2 PASS; other historical native evidence is labelled historical. |
| `tests/contracts/p4b-direct-entry-clock-native.test.ts` | 1 | NIPT_TEST_DATABASE_URL absent; disposable-native grant/race/upgrade coverage not run in this full suite. P2 and P2-P3 ran separately:2 PASS; other historical native evidence is labelled historical. |
| `tests/contracts/p4b-native.test.ts` | 1 | NIPT_TEST_DATABASE_URL absent; disposable-native grant/race/upgrade coverage not run in this full suite. P2 and P2-P3 ran separately:2 PASS; other historical native evidence is labelled historical. |
| `tests/contracts/p4c-evidence-native.test.ts` | 1 | NIPT_TEST_DATABASE_URL absent; disposable-native grant/race/upgrade coverage not run in this full suite. P2 and P2-P3 ran separately:2 PASS; other historical native evidence is labelled historical. |
| `tests/contracts/p4c-native.test.ts` | 1 | NIPT_TEST_DATABASE_URL absent; disposable-native grant/race/upgrade coverage not run in this full suite. P2 and P2-P3 ran separately:2 PASS; other historical native evidence is labelled historical. |
| `tests/contracts/p5-legacy-samples.test.ts` | 1 | Explicit legacy parser/sample fixture path absent; differential/vendor sample coverage remains unrun. |
| `tests/contracts/p5-native.test.ts` | 1 | NIPT_TEST_DATABASE_URL absent; disposable-native grant/race/upgrade coverage not run in this full suite. P2 and P2-P3 ran separately:2 PASS; other historical native evidence is labelled historical. |
| `tests/contracts/p5a-auto-link-native.test.ts` | 1 | NIPT_TEST_DATABASE_URL absent; disposable-native grant/race/upgrade coverage not run in this full suite. P2 and P2-P3 ran separately:2 PASS; other historical native evidence is labelled historical. |
| `tests/contracts/p5h-native.test.ts` | 1 | NIPT_TEST_DATABASE_URL absent; disposable-native grant/race/upgrade coverage not run in this full suite. P2 and P2-P3 ran separately:2 PASS; other historical native evidence is labelled historical. |
| `tests/contracts/p6-native.test.ts` | 33 | NIPT_P6_NATIVE_URL absent; native crash/fault/concurrency coverage is not claimed by this full run. |
| `tests/contracts/p7-safety-native.test.ts` | 1 | NIPT_P7_NATIVE_URL absent; native P7 owner/app_rw safety test not run in this suite. |
| `tests/db/concurrency.test.ts` | 1 | NIPT_TEST_DATABASE_URL absent; disposable-native grant/race/upgrade coverage not run in this full suite. P2 and P2-P3 ran separately:2 PASS; other historical native evidence is labelled historical. |
| `tests/db/migration-103.test.ts` | 1 | NIPT_TEST_DATABASE_URL absent; disposable-native grant/race/upgrade coverage not run in this full suite. P2 and P2-P3 ran separately:2 PASS; other historical native evidence is labelled historical. |
| `tests/db/settings-zip-simulation.test.ts` | 4 | Explicit ZIP fixture manifest absent; real ZIP sample consumer coverage not run. |
| `tests/db/workbook-f52-approved.test.ts` | 1 | NIPT_TEST_NATIVE_EXCEL != yes; F52 opt-in native Excel test not run. Actual Native Excel Seq Browser preview passed separately. |
| `tests/unit/workbook-runtime.test.ts` | 1 | NIPT_TASK_MASTER_PATH absent; explicit configured-owner-master branch not run. Default verified Master contracts and actual runtime downloads passed. |

Condition totals:17 default native-DB opt-ins,33 P6 native,1 P7 native,2 legacy fixture/parser,4 ZIP fixtures,1 native Excel and1 explicit Master path =59. Compared with the historical62 skips, the2 DCC PDF tests and1 form-asset staging test ran with configured actual templates in this run; no skipped test was deleted or silently counted PASS.

All skipped test names:

**`tests/contracts/lab-repeat-native.test.ts`**

- native LAB repeat-order state changes retain immutable case/round/attempt lineage

**`tests/contracts/ln-integrity-native.test.ts`**

- native LN integrity: concurrent different-HN registration, concurrent PET workers, concurrent discovery

**`tests/contracts/native.test.ts`**

- native PostgreSQL pg-boss worker and PET/redraw integration
- native worker cannot bypass outbound identity validation on retries

**`tests/contracts/p2-native.test.ts`**

- native P2 app_rw grants, simultaneous registration/version races and immutable evidence

**`tests/contracts/p2-p3-native.test.ts`**

- native P2-P3: registration vs PET races for ANC and LAB_DIRECT, and P2 case/signing locks vs worker S1 apply in both orders

**`tests/contracts/p3-legacy-differential.test.ts`**

- AT-HISIN-02 differential: TS parser equals legacy Python parse_pet_file on 100 synthetic files

**`tests/contracts/p3-native.test.ts`**

- native P3 inbound: concurrent registration vs worker, real worker scan, Test Connection, share outage

**`tests/contracts/p4-native.test.ts`**

- native P4: concurrent receipts never duplicate LN Halos; concurrent assignment/receipt/batch creation serialize

**`tests/contracts/p4b-direct-entry-clock-native.test.ts`**

- native DIRECT_ENTRY Pool/DNB/QC4 timestamps come from the database clock under ±3 s application clock skew

**`tests/contracts/p4b-native.test.ts`**

- native P4b app_rw: concurrent create/crosscheck, immutable evidence, atomic source invalidation

**`tests/contracts/p4c-evidence-native.test.ts`**

- native app_rw P4c rejects malformed F5, cell plans, exact verification and first-cycle evidence; serializes raw reviews

**`tests/contracts/p4c-native.test.ts`**

- native P4c app_rw: idempotent create race, optimistic conflicts, immutable evidence, rollback and upstream Stop-use

**`tests/contracts/p5-legacy-samples.test.ts`**

- P5 legacy sample parity (NIPTY_handover samples/bgi_pdf) classifies and reads all 100 legacy synthetic result files exactly as cases.csv records them

**`tests/contracts/p5-native.test.ts`**

- native P5: idempotent certification, redraw vs certify, one approval, one version per file, role boundaries

**`tests/contracts/p5a-auto-link-native.test.ts`**

- native P5-A: concurrent system links of one round produce one link and no failed import

**`tests/contracts/p5h-native.test.ts`**

- native P5H: one case per LN under races, idempotent batch confirmation, role boundaries

**`tests/contracts/p6-native.test.ts`**

- P6 native PostgreSQL 17: isolated sandbox only atomically reserves one N/ID under 12 real concurrent clients and denies clinical/fixture escalation
- P6 native PostgreSQL 17: isolated sandbox only two workers plus concurrent retry calls cannot publish the same transfer twice
- P6 native PostgreSQL 17: isolated sandbox only a new worker connection resumes after file publication/checkpoint loss with identical inode/bytes/N
- P6 native PostgreSQL 17: isolated sandbox only native PDF/BEFORE_WRITE failure is durable and obeys retry/reconcile policy
- P6 native PostgreSQL 17: isolated sandbox only native PDF/AFTER_TEMP_SYNC failure is durable and obeys retry/reconcile policy
- P6 native PostgreSQL 17: isolated sandbox only native PDF/BEFORE_PUBLISH failure is durable and obeys retry/reconcile policy
- P6 native PostgreSQL 17: isolated sandbox only native PDF/AFTER_PUBLISH failure is durable and obeys retry/reconcile policy
- P6 native PostgreSQL 17: isolated sandbox only native PDF/AFTER_VERIFY failure is durable and obeys retry/reconcile policy
- P6 native PostgreSQL 17: isolated sandbox only native RES/BEFORE_WRITE failure is durable and obeys retry/reconcile policy
- P6 native PostgreSQL 17: isolated sandbox only native RES/AFTER_TEMP_SYNC failure is durable and obeys retry/reconcile policy
- P6 native PostgreSQL 17: isolated sandbox only native RES/BEFORE_PUBLISH failure is durable and obeys retry/reconcile policy
- P6 native PostgreSQL 17: isolated sandbox only native RES/AFTER_PUBLISH failure is durable and obeys retry/reconcile policy
- P6 native PostgreSQL 17: isolated sandbox only native RES/AFTER_VERIFY failure is durable and obeys retry/reconcile policy
- P6 native PostgreSQL 17: isolated sandbox only native BACKUP/BEFORE_WRITE failure is durable and obeys retry/reconcile policy
- P6 native PostgreSQL 17: isolated sandbox only native BACKUP/AFTER_TEMP_SYNC failure is durable and obeys retry/reconcile policy
- P6 native PostgreSQL 17: isolated sandbox only native BACKUP/BEFORE_PUBLISH failure is durable and obeys retry/reconcile policy
- P6 native PostgreSQL 17: isolated sandbox only native BACKUP/AFTER_PUBLISH failure is durable and obeys retry/reconcile policy
- P6 native PostgreSQL 17: isolated sandbox only native BACKUP/AFTER_VERIFY failure is durable and obeys retry/reconcile policy
- P6 native PostgreSQL 17: isolated sandbox only native OK/BEFORE_WRITE failure is durable and obeys retry/reconcile policy
- P6 native PostgreSQL 17: isolated sandbox only native OK/AFTER_TEMP_SYNC failure is durable and obeys retry/reconcile policy
- P6 native PostgreSQL 17: isolated sandbox only native OK/BEFORE_PUBLISH failure is durable and obeys retry/reconcile policy
- P6 native PostgreSQL 17: isolated sandbox only native OK/AFTER_PUBLISH failure is durable and obeys retry/reconcile policy
- P6 native PostgreSQL 17: isolated sandbox only native OK/AFTER_VERIFY failure is durable and obeys retry/reconcile policy
- P6 native PostgreSQL 17: isolated sandbox only OK/checkpoint ambiguity stays held and durable operator investigation never resends
- P6 native PostgreSQL 17: isolated sandbox only concurrent withdrawal after OK creates reconciliation and preserves files
- P6 native PostgreSQL 17: isolated sandbox only concurrent withdrawal immediately before OK blocks sentinel publication on native PG
- P6 native PostgreSQL 17: isolated sandbox only final gate read and OK publication hold the same row lock as cancellation
- P6 native PostgreSQL 17: isolated sandbox only abrupt process exit at PDF hardlink window recovers only proven staging twins
- P6 native PostgreSQL 17: isolated sandbox only abrupt process exit at RES hardlink window recovers only proven staging twins
- P6 native PostgreSQL 17: isolated sandbox only abrupt process exit at BACKUP hardlink window recovers only proven staging twins
- P6 native PostgreSQL 17: isolated sandbox only abrupt process exit at OK hardlink window recovers only proven staging twins
- P6 native PostgreSQL 17: isolated sandbox only simulated receiver pickup is unconfirmed, timeout creates work, CLI records synthetic confirmation/history/status
- P6 native PostgreSQL 17: isolated sandbox only existing application worker processes the P6 queue only with explicit opt-in; audit and migrations remain valid

**`tests/contracts/p7-safety-native.test.ts`**

- native P7 owner/app_rw reject clinical state INSERT/UPDATE; ordinary lifecycle and independent AL5 HOLD survive

**`tests/db/concurrency.test.ts`**

- isolated native PostgreSQL concurrency serializes eight genuinely concurrent registration transactions across clients

**`tests/db/migration-103.test.ts`**

- native PostgreSQL: fresh install and populated 102 → 103 upgrade preserve data and are idempotent

**`tests/db/settings-zip-simulation.test.ts`**

- Settings → Worker/Consumer → observable result, with NIPTY_handover.zip sample files A. PET reception: Settings path → worker → registry/worklist; read-only source; missing OK, duplicate, invalid, non-NIPT and identity conflict
- Settings → Worker/Consumer → observable result, with NIPTY_handover.zip sample files B. changing the inbound path while running: new path only, old configuration refused, errors visible, recovery and rollback
- Settings → Worker/Consumer → observable result, with NIPTY_handover.zip sample files C. external result PDFs from the ZIP: Settings folder → worker scan/preview → parse equals cases.csv; P5-A never links an unclear match; switch folders
- Settings → Worker/Consumer → observable result, with NIPTY_handover.zip sample files D. HIS delivery through Settings: RES/PDF/OK equal the ZIP expected output (de-identified), order, backup, idempotency, failure/retry

**`tests/db/workbook-f52-approved.test.ts`**

- F52 native Excel: D52 draft/save/resume matches XLSX and PDF recalculation, then rebinds changed concentration

**`tests/unit/workbook-runtime.test.ts`**

- configured owner master loads, while the explicitly supplied obsolete master is rejected

