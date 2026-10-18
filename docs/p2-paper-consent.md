# Paper Consent: a marker only (Owner correction 2026-10-18)

**Status:** implemented on `feat/task-list-parity-p0`. Migration 101 was approved by the Owner on 2026-10-18 for isolated synthetic databases only.

## Workflow

1. On the case page, the ANC nurse presses **ใช้ Paper Consent**. A representative case can also choose paper from the consent dialog.
2. The system records the marker `p2_workspace.consent_mode = 'Paper'` and audits it as `P2_MODES_CHANGED`.
3. The case page shows **Paper Consent**: "เลือกใช้เอกสารกระดาษแล้ว — ดำเนินการขั้นตอนถัดไปได้ (ไม่ใช่หลักฐานการลงนาม)". The patient list (`/cases`) shows a **Paper Consent** badge.
4. The next step can start right after saving:
   - clinical review (`approveClinicalP2`);
   - Lab gate BG-04 → `PASS PAPER_CONSENT_SELECTED`;
   - result gate RG-10 → `PASS PAPER_CONSENT_SELECTED`;
   - the database readiness rule `p2_clinical_documents_ready` (migration 101), used by the clinical-review trigger, Lab clinical state, the release guard and outbound;
   - ANC dashboard document readiness.

## What the marker does NOT do

- **Not signing evidence.**
  - It creates no signature, no consent decision, no `p2_consent_signature`, no `p2_final_consent` and no `p2_paper_review`.
  - The consent preview says "เลือกใช้ Paper Consent — ไม่ใช่หลักฐานการลงนาม". It ticks nothing and prints no decision or signing date.
- **No extra steps.** These were removed from the case page for consent:
  - "จัดเตรียม Consent กระดาษ" (print / prepare);
  - "ตรวจ Consent กระดาษ" (verification / receipt).

  Nothing requires:
  - printing through NIPT-CBH;
  - uploading or scanning;
  - a Signature Pad;
  - waiting for the paper to reach the Lab;
  - a receipt confirmation;
  - a new approval.

## What still stops the round

| Situation | Effect |
|---|---|
| Withdrawal (`p2_revocation`) | Blocks, as before |
| A recorded refusal: a paper review `Declined`, a verified paper review whose decision is not `Granted`, or an electronic `Declined` signature | Blocks: `CONSENT_DECLINED`, BG-04 `CONSENT_DECLINED` |

## Unchanged

- **Digital Consent:**
  - the patient signs on the Signature Pad;
  - the doctor comes from the Doctor Registry and must match the request;
  - the 12 acknowledgements are recorded;
  - the gate needs the signed and Granted final consent.
- **Paper Request:** still needs its verified paper review.
- **Migration 088:** not edited. Migration 101 replaces only `p2_clinical_documents_ready`. The Request and Electronic Consent branches are byte-identical, and this is test-proven.

## Default and explicit selection (Go-Live check)

A case never starts with the marker. `workspace()` creates every case with `consent_mode='Electronic'`; the LAB_DIRECT default applies to the Request only. Paper Consent exists only after someone presses **ใช้ Paper Consent** (`setModes`). Without this, every Lab-registered case would have passed the consent gate with nobody choosing it.

## Release and rollback

- **Forward only.** Migration 101 is applied by `tools/migrate.ts` to synthetic and operational databases through the ledger, with checksum verification. It is not applied to any real or Production database by this work.
- **Upgrade proof on real PostgreSQL 17.** A populated database at migration 100 was cloned, 101 was applied, and `p2_clinical_documents_ready` was compared for every existing round: no round changed (Electronic-consent rounds and Declined paper rounds unchanged; every Paper-consent round that was not ready stays not ready for its Request or collection-date reason).
- **Rollback.** Migrations are never edited or deleted. To restore the old readiness rule, ship a new forward migration that replaces the function with its 088 body (below), and re-run the ANC dashboard and lab gate tests. Rolling the application back without the migration is safe: the old code only needs the function to be at least as permissive as 088.

```sql
CREATE OR REPLACE FUNCTION p2_clinical_documents_ready(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT COALESCE((SELECT
  x->>'currentRoundId'=target::text AND x->>'revoked'='false'
  AND (CASE WHEN x->>'requestMode'='Electronic' THEN x#>'{requestDocument,payload,draft}'=x->'draft' ELSE x#>>'{paperRequest,status}'='Verified' END)
  AND (CASE WHEN x->>'consentMode'='Electronic' THEN x#>>'{finalConsent,document_id}'=x#>>'{consentDocument,id}' AND x#>>'{finalConsent,payload,signature,decision}'='Granted' AND x#>'{consentDocument,payload,workspaceVersion}'=x->'workspaceVersion'
       ELSE x#>>'{paperConsent,status}'='Verified' AND x#>>'{paperConsent,panel,decision}'='Granted' END)
  FROM (SELECT p2_clinical_source(target) x) source),false)
 AND (SELECT count(DISTINCT collection_date)=1 FROM (
  SELECT collection_date FROM (SELECT DISTINCT ON(source) collection_date FROM p2_collection_fact WHERE round_id=target ORDER BY source,sequence DESC) latest
  UNION ALL SELECT collection_date FROM specimen_round WHERE id=target AND received_source='HIS_PET_RECEIPT' AND collection_date IS NOT NULL
 ) dates)
$$;
```

## Tests

| Test | Proves |
|---|---|
| `tests/db/operational-clinical.test.ts` | Marker-only round passes the DB readiness rule and clinical review, with no consent review and no signature rows. A recorded refusal → `CONSENT_DECLINED`. Electronic mode still needs the signed consent. |
| `tests/db/p4-lab.test.ts` | BG-04 passes on the marker (mutation-checked); paper Request still required; refusal fails |
| `tests/unit/p5-gates.test.ts` | RG-10 `PAPER_CONSENT_SELECTED` |
| `tests/unit/anc-forms-fields.test.ts` | Preview status `PAPER_SELECTED` with no ticks, decision or date |
| `tests/db/migration-101.test.ts` | Upgrade of a populated 100 database: ledger checksums, 088 unchanged, only one function replaced |
| `tests/db/digital-consent-evidence.test.ts` | Digital Consent unchanged: registry doctor signature in the document, 12 acknowledgements, patient Signature Pad vector/PNG/hash, final consent only after preparer attestation, real Chromium PDF with both signature images, ordered audit events and a valid audit chain |
| `tests/e2e/p2.spec.ts` | Browser: one click, marker on the case and in the list, no paper/Signature Pad buttons, no signing evidence, preview header `X-Consent-Status: PAPER_SELECTED`. A recorded refusal still stops the round. |
