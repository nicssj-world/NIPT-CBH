# Final Result PDF — two intake channels (Owner 2026-10-18)

Both channels use the same intake, quarantine, parser, file store, report versioning, P5-A / two-person linkage and P5-B release workflow. There is one result system, not two. Neither channel reviews, certifies, releases or sends a result.

## 1. What existed before this change

| Item | Found in source | Reused / changed |
|---|---|---|
| Folder intake (Settings `result_management.pdfSourcePath`) | Worker jobs Test Path / Scan / Preview → `confirmImport` by staff on the Results page (`packages/results/folder.ts`, `jobs.ts`). Scheduled scan lists new files only (Owner A23). | Reused unchanged. Only the P5-A link at import (migration 100) is new. |
| Browser upload on the Results page (`/api/p5/results/upload`) | Files queued; parsed **by the Worker** (`synthetic_result_parse`); not tied to a case | Kept as is. It does not work while the Worker is down. |
| Upload per patient case | **Did not exist** | Added (below) |

## 2. Fallback: "อัปโหลด PDF ผลตรวจ" on the case page

**UI.** The panel "ผล PDF ฉบับสุดท้าย" is on `/cases/<id>`. It is shown to roles with `result.review` read; only `result.import` holders can upload. It shows:
- the PDF status of each round: ยังไม่มีผล / รอจับคู่ / รอตรวจรับ / ยืนยันแล้ว;
- the reports of the case and their channel;
- the folder-channel health: Worker heartbeat and the last scan error.

**Step 1 — check.** `POST /api/p5/cases/<id>/pdf-intake` (`caseUploadCheck`):
- The staff member chooses the round and attempt (default: the current round and its latest attempt).
- The file is stored content-addressed and screened, then parsed **in the web request**. No Worker job is created.
- The PDF is compared with the selected target on the RG-04 keys:
  - for a result: HN, DOB, pregnancy, collection date, GA;
  - for a notice: HN.
- Any MISMATCH gives `IDENTITY_CONFLICT_WITH_SELECTED_CASE`. Missing data gives `IDENTITY_NOT_VERIFIABLE`. In both cases nothing is attached: the intake is closed (`Expired`) and audited `RESULT_CASE_UPLOAD_REFUSED`.
- The same bytes already in the system (from the folder or an earlier upload) give `DUPLICATE`, with a link to the existing report. Nothing is created or replaced.
- If the check passes, the page shows the comparison table and a PDF preview.

**Step 2 — confirm.** `POST /api/p5/cases/<id>/pdf-intake/confirm` (`caseUploadConfirm`):
- The comparison is re-checked.
- The normal `confirmImport` runs: version, file asset, name-conflict acknowledgement (A14), and the P5-A system link when it is switched on.
- A `result_version_event` records the channel (`channel=MANUAL_UPLOAD`, case, round, attempt). Audit `RESULT_CASE_UPLOADED` is written.
- If the version is still Unlinked, the uploader **proposes** the selected target. A second authorised person approves, under the existing D-18 rule.
- A system link to any other target is refused (`AUTO_LINK_TARGET_DIFFERS`).

**What is recorded:**
- the original PDF bytes, unchanged;
- SHA-256 (`result_report_version.sha256`);
- the uploader (`imported_by`) and the time (`imported_at`);
- the channel in the immutable version event.

**Limitation.** `result_intake_file.source` stays `UPLOAD`: its CHECK allows only FOLDER / UPLOAD. A dedicated column value `MANUAL_UPLOAD` would need a new migration, which is not approved. So the channel is recorded in the version event and audit instead.

## 3. Primary: automatic folder intake — status

| Requirement | Status |
|---|---|
| Folder set in Settings, scanned by the Worker | Implemented (Settings acceptance) |
| Worker **imports** without a person | **Blocked — needs approval.** The Worker DB role `worker_rw` deliberately cannot create report versions, link events or gate evaluations (`packages/db/roles.sql`). Every intake and import also needs an accountable `app_user`. An unattended import needs one of two things: (a) widening `worker_rw` plus a provisioned system account, or (b) a new migration with a narrow SECURITY DEFINER import function. Neither is approved, so neither was done. |
| Auto-match when clear | Implemented (P5-A) at import |
| Unmatched → staff match from the pending list | Existing Results page queue (`Unlinked` / `LinkConflict`) |
| No auto-release / auto-send | Enforced |

## 4. Tests

DB tests (`tests/db/p5-case-upload.test.ts`) plus the operational journey and the browser:

| # | Required test | Evidence |
|---|---|---|
| 1 | Folder intake succeeds | Worker scan job → preview → import → P5-A link → "รอตรวจรับ" |
| 2 | Case-page upload succeeds | Check READY (all keys MATCH) → confirm → proposal. The same person cannot approve; a second person can. With P5-A on, it links to the same selected target. ANC is refused. Browser: wrong-patient refusal, preview, attach, second-person approval, status "รอตรวจรับ". |
| 3 | Worker stopped, upload still works | Stale heartbeat: the panel shows the folder channel down. Upload succeeds with **no job created** (DB + browser). |
| 4 | Wrong patient refused | Another patient's PDF → `IDENTITY_CONFLICT_WITH_SELECTED_CASE` (HN). Another collection date → refused (collectionDate). No version created. A direct confirm of the refused intake fails. |
| 5 | Same file via both channels | Folder then upload → `DUPLICATE` of the same version. Upload then folder → scan `IMPORTED`, import `Duplicate`. One version each. |
| 6 | Worker back, accepted PDF intact | Reviewed version: re-scan of the same bytes → Duplicate; a different PDF for the round → separate Unlinked (`SERIES_NOT_EMPTY`). The accepted version's state, SHA, row version and link are unchanged. |
| 7 | P5-B still required | Synthetic: no release, no outbound job, accept-and-release refused outside operational mode. Operational (`tests/db/operational-results.test.ts`, mode `CASE_PAGE_UPLOAD`): case-page upload → second-person link → P5-B accept → release → RES/PDF/OK with `hisConfirmed=false`. |

**Fix found by the browser test:** after confirming, choosing the same file again did nothing, because the browser fires no change event for the same file. The file input is now reset after each confirm.
