# Legacy Functional Parity Matrix (P5 scope and project inventory)

2026-10-13 · Owner lock "Owner Architecture & Full Legacy Functional Parity" · branch `feat/p5-result-management-synthetic`.

**Principle:** one NIPT CBH system, complete legacy functional coverage and no silent feature loss. The NIPTY runtime is never run. Both archives were read in place, read-only, with no code executed:

| Archive | SHA-256 (source register) | Content relevant to parity |
| --- | --- | --- |
| `NIPTY.zip` (275,673,797 B) | `ec541930…e99e8` | `app/` v1.4.3, `updates/NIPTY_update_1.2.0…1.4.3`, `app/maintenance.py`, tools. It also contains real operational PDFs, `.res` and `.ok` files, which were **not opened** |
| `NIPTY_handover.zip` (5,483,650 B) | `332ef048…4d9c` | `source/app/` (application code byte-identical to `NIPTY.zip` for every route and service compared), `docs_md/SPEC.md`, `samples/` (100 synthetic BGI PDFs + `cases.csv`, 110 `.pet`, 100 `.res`) |

Status values: **IMPLEMENTED** (in NIPT CBH, with a parity test listed) · **PARTIAL** · **MISSING** · **DEFERRED** (owned by a named later phase and gate) · **OWNER_DECISION_REQUIRED**. Nothing is IMPLEMENTED without test evidence. Synthetic test success is not clinical or Production acceptance.

## A. Result PDF intake, parser, matching, preview and review (P5, this milestone)

| # | Legacy capability | Legacy source | NIPT CBH implementation | Parity / evidence test | Status | Difference / conflict |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | PDF result folder path setting (`path_pdfresult`) | `database.py` seed, `settings.html` | `result_management.pdfSourcePath` (typed form field, Draft→Validate→Approve→Activate) | `tests/unit/p5-settings.test.ts`, `tests/e2e/p5-results.spec.ts` (Settings) | IMPLEMENTED | Synthetic mode accepts only `simulator/results[/…]`; a hospital path is refused (`SIMULATOR_PATH_REQUIRED`) until IT authorization. Changes are maker-checker instead of NIPTY's direct save |
| A2 | Test Path button | `file_scanner.test_path`, `/settings/test-paths` | Worker job `synthetic_result_test_path` → `testResultFolder` | `p5-results-flow.test.ts` (Test Path), e2e folder workflow | IMPLEMENTED | NIPTY tested `path_pdfresult` by **writing** a probe file (`.nipt_write_test`) and created the folder if it was missing. NIPT CBH is read-only (no mkdir/touch), because the result folder is source evidence. Reported for Owner awareness |
| A3 | Scan Folder (recursive `rglob` of `.pdf` + `.zip`, newest first, SHA-256, "already imported", sub-folder column) | `scan_pdf_folder_new`, `/import/scan` | Worker job `synthetic_result_scan` → `scanResultFolder` | `p5-results-flow.test.ts` (Scan), e2e | IMPLEMENTED | Adds in-scan duplicate, too-large, empty and ZIP-disabled statuses. Symlinks, hidden files and unsafe names are skipped, with a depth limit of 8 and the `maxFilesPerScan` limit |
| A4 | Select files → Preview → Confirm import | `import.html` Section B, `/import/pdf/preview`, `/import/pdf/confirm` | Results page stepper (Test Path → Scan → Preview → Confirm); worker `synthetic_result_preview`; `confirmImport` | e2e folder workflow, `p5-results.test.ts` | IMPLEMENTED | Preview bytes are quarantined and content-addressed. Confirm requires the same person and expires after 24 h. Bytes changed between Scan and Preview are rejected (`CHANGED_SINCE_SCAN`) |
| A5 | Browser upload as alternative (multiple `.pdf`/`.zip`, keeps Thai/space names) | `_get_upload_paths_with_names` | `/api/p5/results/upload` → `registerUploads` → worker parse | `p5-results-flow.test.ts` (browser file picker), e2e (upload tab renders, axe) | IMPLEMENTED | Same quarantine and parse path as folder files |
| A6 | Latest imported folder line ("นำเข้าล่าสุดถึงโฟลเดอร์") | `get_latest_pdf_source_folder`, `/import/pdf/latest_folder` | `resultQueue().latestFolder`, shown on the Results page | `p5-results-flow.test.ts` (latestFolder) | IMPLEMENTED | Same rule as NIPTY: the most recent folder is the one with the greatest name |
| A7 | ZIP-as-PDF (manifest.json → 1.txt), real PDF, real ZIP | `pdf_parser._extract_from_zip/_extract_from_pdf` | `packages/results/extract.ts` + `zip.ts` | `p5-parser.test.ts`, legacy samples (10 ZIP-as-PDF) | IMPLEMENTED | Type is detected by magic bytes. Encrypted, ZIP64, bad-CRC and zip-bomb files are refused |
| A8 | Batch ZIP holding many PDFs (skip "(1).pdf" duplicates) | `parse_batch_zip`, `_is_batch_zip` | `extract()` ZIP_BATCH → one intake per member | `p5-results.test.ts` (batch) | IMPLEMENTED | Each member keeps its own SHA-256 and its parent link |
| A9 | Anchored parse: LN, HN, name, GA weeks/days, DOB, collection/received/reported dates, T21/T18/T13, fetal gender, SCA ×4 + FF, QC | `pdf_parser._parse_text` | `packages/results/parser.ts` | **AT-RES-01:** `tests/contracts/p5-legacy-samples.test.ts`, all 100 handover samples equal to `cases.csv` (HN, LN, type, trisomy, SCA, all ANCHORED) | IMPLEMENTED | Dates are normalised to ISO at parse time (F-12). Raw text, method and parser version are stored per value |
| A10 | Fallback positional trisomy / SCA "Not Detected ×4" → `needs_manual_review` | `_parse_text` Module 2 / v1.3.1 fixes | FALLBACK method + `needsManualReview` | `p5-parser.test.ts` | IMPLEMENTED | — |
| A11 | Unreadable SCA must not look normal (v1.3.1 lesson: 38 silent blanks) | `_parse_text` comments | UNREADABLE is never Normal or 0 and blocks RG-02 | `p5-parser.test.ts`, `p5-gates.test.ts` | IMPLEMENTED | — |
| A12 | Result type classification final / redraw_notice / unknown (filename + text hints) | `classify_result_type` | `templateKind` SINGLETON / TWIN / REDRAW_NOTICE / UNKNOWN; UNKNOWN → RejectedImport | `p5-parser.test.ts`, legacy samples (5 notices) | IMPLEMENTED | Adds a twin template (proposed synthetic anchors; NIPTY SPEC records "no twin case seen") — OD-07 must verify against hospital synthetic PDFs |
| A13 | Duplicate file detection by SHA-256 (`import_log`) | `is_already_imported` | `result_report_version.sha256` UNIQUE + intake `Duplicate` | `p5-results.test.ts`, native test (concurrent) | IMPLEMENTED | — |
| A14 | Duplicate by raw filename skipped on confirm | `pdf_confirm` (`raw_filename`) | Not carried: duplicates are by content only | — | OWNER_DECISION_REQUIRED | A different PDF with the same filename (e.g. a corrected report) is imported as a new version and must go through revision. Name-based skipping could silently drop a correction. Proposal: keep content-based detection |
| A15 | Auto-match result↔order by HN (1:1 auto, many = ambiguous, 45-day cutoff) | `matcher.auto_match_all` | **Not automatic.** HN, lab number or HIS LN only *find* candidates. A person proposes a round/attempt and a second person approves after a multi-property cross-check | `p5-results.test.ts` (AT-ID-02/06, no auto-link), e2e | IMPLEMENTED (safe replacement) | **Conflict:** LOCKED §14 / LD-01 forbid HN-only or LN-only auto-match. The outcome (quick matching) is kept through the candidate list. `AUTO_PIC` stays HOLD until OD-07 |
| A16 | Manual match / unmatch / unmatched queue / dismiss / search | `/unmatched`, `manual_match`, `unmatch` | Review queue buckets; `proposeLink`/`decideLink`/`unlinkVersion`; void of an unlinked import | `p5-results-flow.test.ts` (unlink/void) | IMPLEMENTED | Two-person (D-18, OD-04 point 4). Every step is an append-only event |
| A17 | Rematch an order | `/rematch/<order>` | Unlink → propose → approve | `p5-results-flow.test.ts` | IMPLEMENTED | — |
| A18 | View original PDF (`/pdf/<id>`, inline) | `pdf_routes.view_pdf` | `/api/p5/results/[id]/file` (no-store, access-logged, `nosniff`); review screen frame | e2e (ANC denied), manual Chrome check of the frame (this report) | IMPLEMENTED | ZIP-as-PDF originals are downloaded, not rendered |
| A19 | Results list with filters + CSV/TXT export | `results_routes.results_list`, `/results/export` | Review queue by state | — | PARTIAL | Filtering by date/risk and CSV export are not built. An export of PHI needs the `report.export` policy (P7 reporting / OD-13 DPO). Owner: P7, gate AL-7 |
| A20 | Result detail page (values, raw text) | `/results/<id>`, `results.html` | `/results/[id]`, values with raw text and method | e2e | IMPLEMENTED | — |
| A21 | Maintenance `reparse` (re-parse old PDFs to fill SCA) | `maintenance.py reparse` | Parser version stored per file; originals are immutable | — | DEFERRED | A controlled re-parse creating new evidence (never overwriting) belongs to P7 operations. Gate AL-7 |
| A22 | Maintenance `backfill-ga`, `repair-match`, `audit` | `maintenance.py` | GA is parsed at import; matching is never repaired automatically | — | DEFERRED | P5H/P7 (historical data). Gate AL-8 / AL-7 |
| A23 | Upload/scan auto-scan interval for PDFs (`auto_scan_min`) | settings seed | Not built | — | OWNER_DECISION_REQUIRED | Owner start order forbids auto-import without approval. NIPTY's default is 0 (off) |
| A24 | Redraw notice is not a final result; a new final result can still match the same order | `_find_order_for_hn` | REDRAW_NOTICE kind, RN gate, notices never count as a result; round-aware linkage | `p5-gates.test.ts`, `p5-results-flow.test.ts` (RN-03) | IMPLEMENTED | Matching is per round under the same LN (LD-01) |

## B. Settings (all 25 NIPTY keys, identical in both archives)

Every key is mapped in the generated [Settings Coverage Matrix](p5-settings-coverage.md), enforced by `tests/unit/p5-settings.test.ts`.

| NIPTY key(s) | NIPT CBH | Status |
| --- | --- | --- |
| `path_pdfresult` | `result_management.pdfSourcePath` | IMPLEMENTED |
| `path_request`, `pet_autoimport_enabled`, `pet_scan_interval_min`, `pet_scan_days_back`, `nipt_testcode` | `his_inbound.*` (P3) | IMPLEMENTED (P3 evidence) |
| `path_workload`, `auto_scan_min` (STAT .txt) | Superseded by HIS `.pet` inbound (Plan §10); `auto_scan_min` for PDFs is held (A23) | IMPLEMENTED (superseded) / OWNER_DECISION_REQUIRED |
| `path_resoutput`, `path_pdfrename`, `pdf_template`, `hospital_suffix`, `hl7_*` (8), `nipt_result_text` | HIS Outbound/CFS | DEFERRED — P6, gate AL-6 |
| `nipt_result_style` | `his_outbound.resultStyle` (stored, unused) | PARTIAL — P6 |
| `alert_days` | No TAT/overdue threshold yet | MISSING — P4/P7 (Laboratory overdue warning) |
| `server_host`, `server_port` | Deployment configuration, not a web setting | DEFERRED — P7 runbook |

## C. Other legacy capabilities recorded for their owning phase (not implemented here)

| Legacy capability | Legacy source | Owner phase / gate | Status |
| --- | --- | --- | --- |
| HIS `.pet/.ok` inbound parse, scanner, autoimport, status/log/alerts/ack, start/stop toggle | `pet_parser`, `pet_scanner`, `pet_autoimport`, `pet_routes` | P3 (delivered synthetic; AL-3 for real share) | IMPLEMENTED in P3 (see `p3-synthetic-delivery.md`); the toggle maps to the maker-checker `his_inbound.enabled` |
| `.res` generation (UTF-16 LE + BOM, CR separators, R[3] text, accession suffix), single/bulk export, export history, PDF rename/copy to CFS | `res_generator`, `result_text`, `export_routes`, `pdf_exporter` | P6, AL-6 / Q-I3–Q-I5 | DEFERRED (P1 has a synthetic RES contract only) |
| Dashboard summary, pagination, overdue highlight | `dashboard.py` | P4/P7 | PARTIAL (Lab worklist and registry exist; no TAT dashboard) |
| Deleted orders (soft delete/restore) | `/orders/<id>/delete,restore` | P2/P3 | OWNER_DECISION_REQUIRED (NIPT CBH never deletes; cancellation is lineage/events) |
| Users: create, access toggle, reset password, first-run setup | `users_routes`, `auth_routes` | P1/P7 | PARTIAL (RBAC and sessions exist; no user-admin UI) |
| Thai date display (พ.ศ.) | `thai_date.py` | All | IMPLEMENTED (Bangkok time, Thai locale) |
| Network info / LAN URLs | `/api/network-info` | P7 | DEFERRED |
| Proposal/CQI tools (`build_proposal_docx`, `cqi_summary_numbers`, action-plan xlsx) | `tools/` | Not a runtime function | DEFERRED (governance reporting, P7) |

## D. Gaps before "complete" can be claimed

All P5-scope items are IMPLEMENTED or explicitly flagged, except: **A14, A23** (Owner decision), **A19** (CSV export, P7), **A21–A22** (maintenance, P5H/P7). Release-related parity (NIPTY effectively "released" by exporting `.res`) is held by AL-5 (P5 release) and AL-6 (P6 outbound). None of these is closed by synthetic tests.
