# P5 Result Management — restricted synthetic delivery

2026-10-13 · branch `feat/p5-result-management-synthetic` (worktree `NIPT-CBH-P5`, from `origin/main` `5d859c3`) · developed in parallel with Codex P4b (`feat/p4b-halos-export-contract`, Draft PR #2, Pooling/QC2/F4 at `5a628e3`). Nothing in P4b was edited or merged. Synthetic data only. No Production, no live HIS, no real patient data. **Clinical release is HOLD.**

## Authority and sources

- Owner P5 start order (2026-10-13): restricted synthetic P5 in parallel with P4b; NIPTY-style PDF folder intake confirmed; HOLD real release (OD-05/07, AL-5); OD-04 rule (reviewer may certify if authorised, Clinical Governance pending); no simulated `FinalQcAccepted`.
- Owner Architecture & Full Legacy Functional Parity Lock (same day): parity matrix, no silent feature loss. See [p5-legacy-parity-matrix.md](p5-legacy-parity-matrix.md).
- Plan v6.2.1 (`261acf8c…3c2e`, rechecked): §5.7–§5.10, §11, §13, §15 and the P5 acceptance tests. OD-04/OD-13 Owner decision records. P4 and P4b delivery documents.
- `NIPTY.zip` / `NIPTY_handover.zip`: read in place, no runtime executed. Real operational files in `NIPTY.zip` were not opened. The 100 synthetic handover samples were extracted only to a temporary directory for the parity test.

## Migration plan (no collision with P4b)

`db/migrations/050_p5_result_management_synthetic.sql` (`a90b9cbf…d092`). P4b holds 011–013 and will add DNB/Sequencing next. P5 therefore uses a reserved band starting at 050, renumbered at integration only if the review asks (P3 precedent). Additive. 001–010 are unchanged. Grants were appended to `packages/db/roles.sql`.

## What was built

| Area | Implementation |
| --- | --- |
| PDF intake (NIPTY workflow) | Settings `pdfSourcePath` → **Test Path** (worker, read-only) → **Scan Folder** (worker; recursive `.pdf`/`.zip`, newest first, SHA-256, already-imported / in-scan duplicate / too large) → select → **Preview** (worker re-reads, requires the scanned hash, quarantines, parses) → **Confirm import**. Browser file picker as the alternative channel, using the same pipeline. No auto-import. Synthetic mode accepts only `simulator/results[/…]` |
| Quarantine & originals | Magic bytes, size limit, PDF opens (pdf.js, no scripting/fonts), ZIP reader refuses encryption/ZIP64/CRC errors/zip bombs. Originals are content-addressed and immutable. Intake rows are immutable evidence with forward-only states (Quarantined/Parsed/Rejected/Duplicate/Imported/Expired) and reject codes |
| Parser | Template-aware: singleton (NIPTY BGI anchors), twin (proposed synthetic anchors), Redraw notice, unknown (blocked). Value + raw text + method (ANCHORED/FALLBACK/UNREADABLE/NOT_APPLICABLE) + parser version. ISO dates at parse time. Unreadable never becomes Normal |
| PIC / linkage | PIC not Active (OD-07), so only `MANUAL_REVIEWED`, round by round and attempt by attempt. HN, lab number and HIS LN only *find* candidates. The cross-check covers HN, DOB, pregnancy type, the round's collection date and GA (setting tolerance). Proposal by Lab staff, approval by a different certifier, enforced by policy and by a DB trigger. Any mismatch on approval → LinkConflict. Unlink, revision (supersedes the open version with request details) and void of an unlinked import |
| Gates | RG-01–RG-13 / RN-01–RN-07 are three-valued and re-evaluated inside the acting transaction, with lock order LN → Case → Round → Attempt → Version (shared with P4). Validation moves a version to PendingCertification or ValidationBlocked. PENDING never passes |
| Review & certification | Review attestation (values match PDF; abnormal acknowledgement). Certify = one transaction with an idempotency key: evaluates RG/RN, records the evaluation, then answers **BLOCKED** or **RELEASE_HOLD**. `result.certify`/`notice.release` stay denied, and `p5_release_authorized()` = false, so the database refuses `CertifiedReleased` and any `result_release` insert |
| ANC Result Viewer | Case page section. Per round, only Active releases (none can exist yet), the Redraw badge taken from the operational order, and earlier rounds under history. Unreleased PDFs and notices are never returned. Unit scope (OD-13). Access log. `no-store` file API |
| Settings | All 10 categories + `go_live_cutoff` retained in the existing catalog. Labelled form fields replace the JSON textarea. Locked/HOLD fields are read-only with the deciding authority shown. The form starts from the active revision. Draft→Validate→Approve→Activate, maker-checker, RBAC and audit are unchanged. Coverage matrix per category in the UI and in [p5-settings-coverage.md](p5-settings-coverage.md) (generated, test-enforced) |
| RBAC | New actions `result.review` (Lab staff/certifier, Auditor read) and `result.release.check` (certifier). Release actions remain globally denied |
| Worker / CI | Job kinds `synthetic_result_test_path`, `…_scan`, `…_preview`, `…_parse`. CI now starts the worker for e2e. Simulator generates `results/` (sub-folders, twin, notice, ZIP-as-PDF, batch ZIP, malformed file) |

UI (Impeccable + UI/UX Pro Max applied inside the existing design system): Results page (`/results`) with a 4-step stepper, folder and upload tabs, scan and preview tables and a review queue by state. Review page (`/results/[id]`) has the original PDF beside parsed values, the linkage panel with a per-candidate comparison, the gate checklist, review, certify (HOLD) and history. Status is always text. One verification round was taken at desktop 1440 and mobile 390, with fixes for mobile tables, coverage status wrapping and code-to-Thai reasons. The PDF frame was confirmed in real Chrome; headless Chromium has no PDF viewer.

## P4b integration contract (waits for P4b)

P5 reads, never writes: `analytical_attempt.state` (`AnalysisComplete` → RG-06; `FinalQcAccepted` → RG-07, through the existing transition guard), the active `lab_slot_assignment`, batch-cancel lineage, `attempt_stage_qc` (QC1 today; P4b adds later stages), QC1 slot dispositions and `attempt_event` Hold. To make a result eligible, P4b must record QC4/QC5 and Analysis completion and move the attempt to `FinalQcAccepted`. Negative tests already prove P5 refuses everything short of that (AT-RG-01, AT-QC-EARLY-02, AT-RG-06). AT-RES-PDF-01 (Batch → Pool → DNB → Seq → HALOS → PDF) runs after P4b is accepted. No QC certification data is fabricated anywhere. The pure unit test of the RG-07 predicate passes the string `FinalQcAccepted` as an input fact to show the PASS branch. No database row, fixture or API can create it.

## Verification (local, Windows, PostgreSQL 17.11)

| Check | Result |
| --- | --- |
| Typecheck · ESLint (0 warnings) · source guard (313 files) · build · `npm audit --omit=dev` | pass · pass · pass · pass · 0 vulnerabilities |
| Vitest (all, native enabled) | 1,074 passed, 2 skipped: the existing external PET differential and the env-gated P5 legacy samples, which were run separately |
| AT-RES-01 legacy parity (`NIPT_LEGACY_RESULT_SAMPLES_DIR`) | 100/100 NIPTY handover samples match `cases.csv` (HN, LN, type, trisomy, SCA, all anchored) |
| P5 DB tests (PGlite) | 23 tests: import/duplicate/immutability, quarantine codes, batch ZIP, two-person link, LinkConflict, gates/HOLD/idempotency, redraw race, abnormal ack, OD-04, RG-11, revision/unlink/void, stale page, RN-03, ANC scope, upload picker, folder Test Path/Scan/Preview |
| P5 native PostgreSQL (`app_rw`/`worker_rw`) | concurrent duplicate import → 1 version; two approvals → 1; same-key certify ×2 → 1 evaluation; redraw vs certify serialized → RG-05; role boundaries |
| Playwright (full suite, real worker on :3500) | 53/53. The new P5 spec covers the folder workflow end to end, two accounts, HOLD, ANC denial, Settings, axe AA at 375/768/1280/1440. Run on a fresh DB; one existing P2 test hit a transient Windows `ERR_NO_BUFFER_SPACE` on page load and passed on rerun unchanged |
| Visual baseline | `registry-375-win32.png` was regenerated. The diff was limited to the new "ผลตรวจ NIPT" nav link (mobile nav wraps above content). The other baselines are unchanged |

CI for the pushed head is recorded in the Draft PR.

## HOLD and pending

| Item | Needed |
| --- | --- |
| AL-5 / real release | OD-07 PIC + templates verified on hospital synthetic PDFs (incl. twin, notice, redraw rounds); OD-05 confirmation method; OD-04 Clinical Governance sign-off + named certifier matrix; reviewed migration replacing `p5_release_authorized()` |
| OD-09 / OD-17 / OD-16 / OD-08 | Sex/Y disclosure rule; recollection after release; consent/request applicability for round ≥ 2; clinical rule set |
| P4b | QC4/QC5, Analysis completion, `FinalQcAccepted`; AT-RES-PDF-01 E2E |
| Released-version paths | Revision N+1 / Void with ANC badge / Reissue, ANC display of released PDFs: schema and contract exist, untestable until a release can exist |
| Parity decisions | A14 (filename duplicate rule), A23 (PDF auto-scan) → Owner. A19 (CSV export), A21–A22 (maintenance) → P7/P5H |
| Hospital path | IT authorization for the real PDF folder (read-only service identity); synthetic mode refuses it |

## Local environment

`.env.local` (ignored): web 3500, renderer 3501, worker. DBs `nipt_synthetic_p2_browser_p5` (browser; recreate fresh before the full e2e because foundation expects exactly 3 cases) and `nipt_p5_synthetic_test` (native) on the shared Docker PostgreSQL 17 (`127.0.0.1:55443`). Keys and secrets were copied from the P4 worktree because the cluster-global login roles already exist.
