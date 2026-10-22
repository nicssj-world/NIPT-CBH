# ANC Owner consolidated closeout — 2026-10-23

All **25/25 implementation and Local UAT items PASS** in [the checklist](anc-owner-consolidated-checklist-2026-10-23.md). Owner acceptance remains **PENDING**. This is Development synthetic Local UAT; no hospital deployment, push/merge, EXE, production cutoff or clinical acceptance is claimed.

The final exact source/runtime commit is recorded after this document is committed in `.local/anc-owner-closeout-20261023/final-delivery.json` and `FINAL-REPORT.md`. READY requires that final manifest to report PASS/readyForOwnerTest=true, all11 features INCLUDED, no MISSING/BLOCKED, clean primary/snapshot and matching web/worker/renderer. Historical SHA notes in the LAB documents are superseded only for current Local UAT delivery, not erased.

## What changed

- All five Request sections use compact, consistent label/control spacing and responsive choices; retained history wording, identity, formula and permission guards. Approved registration/GA/result labels and footer removals are included.
- Age is readonly completed years from DOB **at collection date**, never today or a stale manual age. SCA preference/input/required validation removed; old records and original Consent SCA explanatory clause retained.
- Auto-save success shows the last successful server timestamp (BE date/24-hour time) and `(Auto)` only for actual Auto saves. Manual saves and unrelated channel edits do not claim Auto success; failed saves show no success timestamp. Actor/time audit remains.
- Paper Request channel has no redundant preparation dialog; channel change needs no reason. This does not fabricate paper verification, signatures or clinical approval. Original paper history remains.
- Consent completion returns the staff member to that exact case after the existing authorized handoff. Stale preparation is replaced through the normal preparation operation, preserving version guards.
- Rendered Consent signature-area placeholder lines are masked only on the derivative; original Masters are unchanged. Frozen signatures, names and dates are aligned. Combined two-page preview includes the actual frozen signed Consent and current Request preview. Hash/scope/refusal/revocation guards remain.
- Clinical readiness displays exact missing work, awaiting authorized review or reviewed; ANC and specimen receipt facts are grouped separately. Existing one authorized clinical review remains; no specimen receipt, QC, release or HIS evidence was invented.

## Validation and revision boundaries

Application behavior revision: `ea12d61e633617192e6b92a797abb0b09f64f002`. Clean validation/runtime revision: `de1b701ccd4f40b0841210703f712a2403d67569` (only checklist/test-driver timing changed after the application revision). Final closeout adds documentation and correction of the obsolete SCA test; application/migration/production dependency files are unchanged. `test-to-delivery-parity.json` checks this after the final commit. Full regression is not repeated for documentation/test-expectation-only changes.

| Evidence | Result |
|---|---|
| Focused unit/DB/actual PDF | 11 files /73 PASS; `affected-ea12.log` |
| Additional follow-up tests | 5 files /49 PASS; overlapping, not added to full-suite unique count |
| Native PostgreSQL | 2 suites /2 PASS in separate disposable `nipt_synthetic_lab_owner_*` DB on127.0.0.1:19831; `native-postgresql.json` / `native-anc.log` |
| Full regression raw | 2378 PASS /1 FAIL /59 SKIP;774.03s; `full-regression.log` / `.json` |
| Raw failure resolved | Old UI assertion required SCA input contrary to latest Owner decision. Only that assertion was updated; entire four-test file reran PASS, plus3 age/SCA tests. No app change. Raw failure retained, never concealed. |
| Reconciled unique coverage | **2379 PASS /0 unresolved FAIL /59 SKIP**; `regression-reconciled.json`. This combines the full run and targeted replacement-file result; it is not a second all-green full-suite invocation. |
| Typecheck / lint / source guard | PASS;1079 source files inspected at application revision; final diff check also required |
| Browser write journey | Real registration/reopen, paper/electronic mode persistence, server ACK/503/retry,12-clause signing, same-case handoff, authorized synthetic clinical review, actual2-page PDF; `browser-write-journey-ea12.json` |
| Responsive/accessibility | All5sections at1440/768/375 in Light/Dark (30 section captures); no overflow, label/control gaps5–16px, axe0, keyboard focus return; refused-button hover inspected |
| Preserved features | All11 groups INCLUDED: top scrollbar, overview LN/highlight, registry LN/highlight,8-digit Thai dates, Toast, Request/Consent, LAB registration/registry, QC/Pooling/Seq, dual XLSX, PDF/results and this consolidated ANC batch |
| Actual PDF visual | `browser-signature-block.png`, `browser-signed-consent.png`, `browser-combined-signed.pdf`; frozen patient+stored doctor images present; exactly2pages |
| Original data | Original60cases,4batches,3releases and16 representative artifacts unchanged; all original77 FileStore files/3,056,986bytes retained by hash. `original-data-preserved.json` / `original-filestore-preserved.json` |
| Restart | Home-UAT Restart reports ready=true/PRESERVED; all22 record-group hashes equal,61cases/4batches/3releases;79files/3,756,272bytes identical; `restart-frozen-baseline.log`, `restart/owner-restart-persistence.json`, `all-filestore-before.json` / `after.json` |
| Post-restart Browser | Real login, same case, age37, actual Auto timestamp, reviewed state and combined2-page PDF PASS; `post-restart-browser.json` |

All artifacts above are under `.local/anc-owner-closeout-20261023/` unless stated otherwise. Complete [59 skipped test names, conditions and risks](anc-owner-regression-skips-2026-10-23.md) are separate; SKIP is never PASS. The two native suites remain SKIP in the full-run tally even though separately executed PASS.

The one new case is **synthetic** LN9903001901/HN9900041901 (`02002b86-b4d7-41f6-bc51-0c91f08e7361`). It has one legitimate test signing and authorized synthetic review; no PET/receipt/analytical result/release was created for it. Additional FileStore objects are this test's signed evidence and a Native Seq preview. An early file comparison included the newly generated preview; its hash exactly matches the downloaded preview (`preview-added-before-restart.json`). All previous files were unchanged; a fresh frozen baseline then passed an exact Restart comparison. No object was removed.

## Open Local UAT and Owner review

URL: **https://127.0.0.1:19548/login** on this Development PC. ANC username: `uat.anc`; LAB: `uat.lab`; independent result review: `uat.certifier`. Passwords are only in the ACL-protected `.local/owner-local-uat-1.0.2/credentials.txt`; they are not copied into reports.

Run in PowerShell7 from this worktree:

```powershell
& .\tools\operational\Home-UAT.ps1 -Action Start -SourceSnapshot '.local/source-complete-uat'
& .\tools\operational\Home-UAT.ps1 -Action Health -SourceSnapshot '.local/source-complete-uat'
& .\tools\operational\Home-UAT.ps1 -Action Restart -SourceSnapshot '.local/source-complete-uat'
& .\tools\operational\Home-UAT.ps1 -Action Stop -SourceSnapshot '.local/source-complete-uat'
```

Start/Health/Restart are tested; Stop is the existing scoped non-destructive service stop and retains volumes. Keep the clean snapshot at the final source SHA; launcher rejects drift and missing feature evidence.

Owner test cases:

1. Overview/registry: LN click and keyboard Enter, row highlight, top horizontal scrollbar, new released label, no removed footnotes.
2. Open LN9903001901; inspect all5 Request sections, age37 at collection15/10/2569, Thai date entry and removed SCA preference. Confirmed Request edits legitimately require the existing amendment reason.
3. Inspect saved Auto timestamp; edit a separate synthetic draft to test Auto-save and explicit save Toast. A failed save must not claim success.
4. View combined2-page document of LN9903001901: the frozen patient/doctor signatures, names and patient signing date must appear. Existing signed Consent is immutable; do not re-sign it.
5. Check grouped clinical/receipt panel: the test review is complete, while actual specimen receipt remains missing. A fresh synthetic case shows exact missing work and the authorized reviewer action when evidence is complete.
6. LAB existing Run001: QC/Pooling/Seq, both saved XLSX downloads, native Preview and existing released result PDFs. Existing LAB baseline cases and scoped approval gates remain available.

## Remaining scope boundaries

- **OWNER-UAT=PENDING** until Owner tests and confirms; visual preference/clinical/hospital acceptance is not inferred from automated tests.
- Sidebar-to-top navigation is **INTENTIONALLY EXCLUDED**: recommendation only, not approved implementation. No menu change was bundled.
- The59 skipped conditions above remain explicit coverage limits. Physical printer/scanner, HALOS/BGI hardware, actual Hospital LAN/HIS ACK and Production clinical acceptance remain NOT RUN.
- Real go-live cutoff and its separate P5H historical promotion remain BLOCKED on the Owner's eventual real go-live decision; no test/current date configured in Persistent Owner UAT. Manual completed-PDF intake/review remains separate.
- Original DCC/reference approval labels and signed originals are preserved. Masking the rendered signature placeholders is not an approval of a new Master.
- No new/modified migration, reset/discard, push, merge, deploy, hospital server access or Upgrade EXE. Local UAT stays running for Owner.

## Git file inventory

Baseline was clean at `44f398b98ee0e0ff7be2dbdce1e2975d0c259d7f`. Each file below was reviewed and included only in this authorized ANC scope; no unrelated dirty work was discarded. Final manifests record every primary/snapshot/runtime source hash and any dirty/untracked mismatch (required empty for delivery).

| File | Handling |
|---|---|
| `docs/anc-owner-consolidated-checklist-2026-10-23.md` | Reviewed scoped new file; included in committed delivery. |
| `docs/lab-workflow-owner-lock-2026-10-21.md` | Reviewed scoped change; included in committed delivery. |
| `packages/forms/layout.ts` | Reviewed scoped change; included in committed delivery. |
| `packages/p2/forms.ts` | Reviewed scoped change; included in committed delivery. |
| `packages/p2/schema.ts` | Reviewed scoped change; included in committed delivery. |
| `packages/p2/service.ts` | Reviewed scoped change; included in committed delivery. |
| `packages/pdf/anc-overlay.ts` | Reviewed scoped change; included in committed delivery. |
| `packages/pdf/dcc-snapshot.ts` | Reviewed scoped change; included in committed delivery. |
| `src/app/api/p2/cases/[id]/forms/route.ts` | Reviewed scoped change; included in committed delivery. |
| `src/components/anc/dashboard.tsx` | Reviewed scoped change; included in committed delivery. |
| `src/components/p2/anc-workspace.css` | Reviewed scoped change; included in committed delivery. |
| `src/components/p2/case-workspace.tsx` | Reviewed scoped change; included in committed delivery. |
| `src/components/p2/registry.tsx` | Reviewed scoped change; included in committed delivery. |
| `src/components/p2/request-form.tsx` | Reviewed scoped change; included in committed delivery. |
| `src/components/p2/shared.tsx` | Reviewed scoped change; included in committed delivery. |
| `src/components/p2/signing.tsx` | Reviewed scoped change; included in committed delivery. |
| `tests/db/dcc-consent-provenance.test.ts` | Reviewed scoped change; included in committed delivery. |
| `tests/db/operational-clinical.test.ts` | Reviewed scoped change; included in committed delivery. |
| `tests/db/p2.test.ts` | Reviewed scoped change; included in committed delivery. |
| `tests/unit/anc-forms-fields.test.ts` | Reviewed scoped change; included in committed delivery. |
| `tests/unit/anc-owner-consolidated.test.ts` | Reviewed scoped new file; included in committed delivery. |
| `tests/unit/dcc-snapshot-pdf.test.ts` | Reviewed scoped change; included in committed delivery. |
| `tests/unit/owner-ui-consistency.test.ts` | Reviewed scoped change; included in committed delivery. |
| `tests/unit/p2-domain.test.ts` | Reviewed scoped change; included in committed delivery. |
| `tools/operational/source-parity-features.json` | Reviewed scoped change; included in committed delivery. |
| `tools/operational/verify-anc-owner-closeout.mjs` | Reviewed scoped new file; included in committed delivery. |
| `tools/operational/verify-source-complete-uat.mjs` | Reviewed scoped change; included in committed delivery. |
| `docs/anc-owner-consolidated-evidence-2026-10-23.md` | New scoped closeout/report. |
| `docs/anc-owner-regression-skips-2026-10-23.md` | New exact skipped-test inventory. |
