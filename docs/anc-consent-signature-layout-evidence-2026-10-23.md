# Consent signature spacing/date patch — 2026-10-23

Owner requested additional space below the Consent table and asked why the doctor date was missing. Source inspection confirmed patient date is an actual signing timestamp; doctor uses an authorized stored registry signature, with no per-document doctor signing timestamp. Owner then explicitly selected **“วันที่จัดทำเอกสาร” from actual data**.

## Implemented scope

- Move both signature labels down by16pt (approximately5.6mm), away from the table border. Both signatures, names and date rows share consistent vertical alignment. Reserve space for two-line names and retain the original footer.
- Patient date remains actual patient signing date. Doctor-side **วันที่จัดทำเอกสาร** uses `p2_document_revision.created_at` of that exact frozen Consent revision, displayed as Buddhist Era date in Asia/Bangkok. It stays fixed on later previews and legitimate case-wide Consent reuse.
- Pass an optional internal renderer field `documentCreatedAt` through both the individual signed-Consent preview and combined2-page preview. Missing creation evidence stays blank; never substitute render time, current day, signature time, registry effective date or stale frozen form text.
- Do not edit original templates, stored signed payloads/hashes, workflows, permissions, migrations or UAT records. The separate locked wait-time wording and top-nav suggestion are unchanged.
- Extend the delivery gate: the consolidated ANC feature cannot be INCLUDED without exact-revision signed/combined PDF Browser evidence from `verify-anc-consent-layout.mjs`.

## Evidence and acceptance

Artifact root: `.local/anc-consent-layout-20261023/`. Final runtime outcome/commit is recorded after commit in `browser.json`, `final-delivery.json`, `final-health.log` and `FINAL-REPORT.md`. Source/unit/build success alone never grants readiness.

| Check | Evidence |
|---|---|
| Red/green date provenance | `red.log` reproduces missing actual creation date; unit test then passes with independent preparation/signing/render dates and missing-evidence cases. Bangkok date boundary tested. |
| Affected PDF/service tests | `affected.log`:6files/54 PASS with actual original templates, including immutable signed documents and DB-derived creation timestamp in combined render input. |
| Source parity tests | `parity-unit.log`:2 PASS. Separate from54. |
| Typecheck / lint | PASS; `typecheck.log`, `lint.log`; final scope lint/diff guard also required. |
| Actual PDF visual | `pdf/signature-layout.png` and `pdf/consent-page.png`: labels clear of border, aligned dates and intact footer; unit/service original Master hashes unchanged. |
| Runtime individual/combined | `browser.json` must be exact-HEAD PASS; actual signed-Consent UI button/iframe and combined link; doctor-side date checked against actual stored revision creation, both frozen signature images and1/2page counts. |
| Data preservation | Baseline61cases/4batches/3releases,22 record groups;80 FileStore files/4,105,915bytes. Before/after snapshot and Browser assert no workspace/revision/final-consent changes. Any new Native Seq preview from completeness is separately hash-accounted. |
| Final completeness/health | `final-delivery.json`: all11features INCLUDED,0MISSING, source/snapshot/web/worker/renderer hashes match; `final-health.log` must report servicesReady/ready=true. |

This patch changes only document presentation and read-only provenance transport. Run affected tests and actual Browser; do not repeat the prior full regression unnecessarily. Previous full/reconciled results remain baseline evidence with [the59 explicit skipped conditions](anc-owner-regression-skips-2026-10-23.md), not a newly executed full suite on this patch. No clinical gate or stored evidence logic changed.

## Owner review

Open **https://127.0.0.1:19548/login**, account `uat.anc`; password remains in protected `.local/owner-local-uat-1.0.2/credentials.txt`. Existing synthetic LN9903001901 is available. Click **ดูใบยินยอมที่ลงนามแล้ว** and **ดูตัวอย่างเอกสารรวม 2 หน้า**. Check space below the table, both signatures/names, patient signing date and the distinct doctor-side “วันที่จัดทำเอกสาร”. The creation day can equal the patient's signing day, but its source is independent.

```powershell
& .\tools\operational\Home-UAT.ps1 -Action Start -SourceSnapshot '.local/source-complete-uat'
& .\tools\operational\Home-UAT.ps1 -Action Health -SourceSnapshot '.local/source-complete-uat'
& .\tools\operational\Home-UAT.ps1 -Action Stop -SourceSnapshot '.local/source-complete-uat'
```

Browser verification command: `node --import tsx tools/operational/verify-anc-consent-layout.mjs`. Run it before the existing consolidated ANC/full completeness verifiers. Exact final commit SHA is in the post-commit final manifest, avoiding a self-referencing tracked report.

OWNER-UAT remains **PENDING**. No push/merge/deploy/hospital server/EXE. Local UAT stays running for Owner after final checks pass.
