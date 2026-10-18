# Settings operational acceptance and P5-A (2026-10-18)

**Branch:** `feat/task-list-parity-p0` (local commits only, not pushed)
**Scope:** Owner directive "OWNER APPROVAL + SETTINGS OPERATIONAL SIMULATION".
- P5-A migration (approved).
- Every Settings category proven through the full path: Settings UI → Save → Validation → Activation → active value → the code that reads it → a visible result.
- Simulation with the original sample files of `NIPTY_handover.zip`.

**Rule used for PASS:** a value counts as PASS only when a test shows the consumer behaving differently because of it. A screen, a Save button, a database row or an API success was never enough on its own.

## 1. ZIP reference files and fixtures

**Archives (read-only, never extracted into the repository, nothing executed from them):**

| Archive | SHA-256 (matches [source-register.md](source-register.md)) | Use |
|---|---|---|
| `NIPTY_handover.zip` | `332ef048…2c4d9c` | `samples/` and `source/tests/fixtures/pet/` were read out into a temporary folder with `MANIFEST.json`. The manifest records the archive hash and, for every file, its ZIP entry and SHA-256. Each test checks every byte it uses against that manifest. |
| `NIPTY.zip` | `ec541930…ae99e8` | **Not used as fixtures.** It contains real patient material: `NIPTPDFresult/` PDFs named with real patients, `NIPTresfileBackUp/` RES backups, `data/nipt.db` and `NIPTWorkload/`. Only its pinned source code was used earlier, by the existing P6 golden oracle. |

**Fixture inventory, from `NIPTY_handover.zip`:**

| Folder / file | Count | What it is | Used for |
|---|---|---|---|
| `samples/README_samples.md` | 1 | States that every value is fictitious ("ข้อมูลสมมติทั้งหมด") and lists the special cases | Provenance |
| `samples/cases.csv` | 1 | Links each case across PET, PDF and RES, with HN, BGI lab number and results | Expected values |
| `samples/request_pet/*-7.pet` + `.ok` | 100 pairs | HIS request files: CP874, CRLF, H/P/O/L. The `.ok` files are 0 bytes. | Test A/B (cases 1–7, 50, 51). Browser test, de-identified. |
| `source/tests/fixtures/pet/` | 10 `.pet` + 9 `.ok` | The legacy parser's own edge cases (see below) | Test A |
| `samples/bgi_pdf/` | 100 | External reports: 90 real PDFs and 10 ZIP files named `.pdf`. Cases 10, 35, 55, 80, 95 are re-draw notices. | Test C (cases 1, 3, 10, 23, 50). Test D (case 1). |
| `samples/result_res/*.res` + `.ok` | 100 pairs | Expected HIS output. RES is UTF-16LE with BOM and CR separators; `.ok` is `ff fe`. | Test D: expected RES and OK |
| `source/app/data/ward_master.csv` | 1 | Legacy ward list | Not used (no NIPT-CBH setting consumes it) |

**Edge cases in `source/tests/fixtures/pet/`:**
- `2622370099` has no `.ok` and an empty citizen ID.
- `2622270900` has no P record.
- `2622270901` has an empty LN.
- `2622270100` is a non-NIPT test code.
- `2622110001-1` and `26220600001-60` are other sections.
- `2622270902` carries several orders.

**Not in the ZIPs, so not tested here:**
- A HIS acknowledgement file.
- A real BGI report layout. The samples are text-only; see the README limitation.
- Real share ACLs.
- A RES with a round-2 collection date.

**De-identification for synthetic-mode runs** (browser, and Test D). The same reversible mapping is applied to the input and to the expected output:
- LN becomes `99000`+LN.
- HN becomes `SYNTHETIC-`+HN (Test D) or `990`+HN (browser).
- Surname becomes `SYNTHETIC`+surname.
- Citizen ID becomes `SYNTHETIC-ID-n`.
- Certifier becomes `SYNTHETIC^SYNTHETIC`.

Encoding, separators and field positions are unchanged. Operational-mode runs (Tests A–C) use the original bytes in an isolated, empty database that was configured operational.

## 2. Simulated HIS environment

Folders are created per run under the OS temporary folder (database tests) or `.local/p0-e2e/data/his-share` (browser). Every one is a loopback path. Each path is entered through Settings and checked against a deployment-owned share policy (`NIPT_HIS_SHARE_POLICY_FILE`: root, purpose, worker service account and mode). Nothing is hard-coded.

| Legacy NIPTY setting (`NIPTY_handover` `SPEC.md`, `pet_scanner.py`, `export_routes.py`) | NIPT-CBH Setting | Simulated folder |
|---|---|---|
| `path_request`: HIS day folders `YYYYMMDD/{LN}-7.pet` + `.ok` | `his_inbound.basePath` (folder that holds the day folders) | `share/in-a/<วันนี้>/`, `share/in-b/<วันนี้>/` |
| `path_pdfresult` | `result_management.pdfSourcePath` | `share/results-a/` (+ sub-folder `2026-08-08/`), `share/results-b/` |
| `path_resoutput`: RES and OK written together | `his_outbound.resDestinationPath` | `share/res/` |
| `path_pdfrename`: PDF for CFS | `his_outbound.pdfDestinationPath` | `share/pdf/` |
| `NIPTresfileBackUp` | `his_outbound.backupPath` | `share/backup/` |

## 3. Results of the required simulations

**Test A — PET reception.** `tests/db/settings-zip-simulation.test.ts`, operational mode, original ZIP bytes.
- Inbound path saved, then Worker test, second-person approval and activation. The Worker job reads the active revision (`INBOUND_CONFIGURATION_USED`).
- One scan of 12 PET files gave:
  - 6 stored;
  - 4 received (`APPLIED_S1`, receive time = PET P[21], source `HIS_PET_RECEIPT`);
  - case 5, registered with another HN: `IDENTITY_MISMATCH` issue, not received;
  - 1 unregistered: Unlinked;
  - 2 unreadable: no P record, empty LN;
  - 3 non-NIPT;
  - 1 waiting for `.ok`.
- The worklist lists the 4 received cases in receive-time order.
- Every file on the share keeps the same bytes and modification time. Nothing is written.
- When `.ok` arrives, the waiting PET is read.
- Re-reading the same PET counts as "unchanged". The same bytes in another day folder count as "same content".
- A changed PET for a received LN is an integrity event, and the receive time does not change.

**Test B — changing the inbound path while running.**
- The new revision makes the HIS panel show "Worker ยังไม่ได้ใช้รุ่นที่เปิดใช้ล่าสุด" until the Worker uses it.
- A queued scan carrying the old configuration is refused (`HIS_CONFIGURATION_CHANGED`).
- A PET dropped into the old folder is not read. The new folder's PET is received.
- These paths fail the Worker test, so approval is refused (`SETTING_NOT_VALIDATED`) and so is activation (`SETTING_APPROVAL_REQUIRED`):
  - a missing path (`SHARE_PATH_NOT_FOUND`);
  - a path outside the allowed root (`SHARE_ROOT_NOT_ALLOWED`).
- Permission error: the Worker runs under an account IT did not authorise.
  - The scan fails with `SHARE_SERVICE_ACCOUNT_MISMATCH`, recorded as a scan run and shown on the panel.
  - Once access returns, the next scan succeeds.
- Rollback to the folder-A revision creates a new version. That version needs a Worker test and a second approval. After activation, folder A is read again.
- `enabled=false` refuses interval scans (`SCAN_DISABLED`). The read-only connection test still works.

**Test C — external result PDFs.**
- Result folder saved: validation, approval, activation.
- Then the Worker job runs Test Path (5 files) and Scan (one copy flagged `DUPLICATE_IN_SCAN`), followed by preview and parse.
- HN, lab number and template kind equal `cases.csv` for cases 1 (PDF), 3 (ZIP named `.pdf`), 10 (re-draw notice) and 50.
- With P5-A on, nothing was linked automatically:
  - case 1: the BGI number `26P77000001` is not that patient's LN Halos or printed ID (`NOT_A_CLEAN_MATCH`);
  - case 3: same reason;
  - case 50 shares its HN with 51 (`AMBIGUOUS_CASES`);
  - the notice is never offered.
- Unlinked reports cannot be accepted, certified, released or sent: 0 releases.
- After import, files show `IMPORTED`. A file changed after the scan is rejected at preview (`CHANGED_SINCE_SCAN`).
- Each scan setting changes what the consumer returns:
  - `scanSubfolders=false` gives 2 files instead of 5;
  - `maxFilesPerScan=2` sets `truncated`;
  - `maxUploadMb=1` marks a larger file `TOO_LARGE`;
  - switching folders lists only the new folder;
  - `acceptZip=false` rejects the ZIP named `.pdf`.
- An invalid folder fails validation and cannot be approved.

**Test D — HIS result delivery.** Synthetic mode, de-identified ZIP case 1.
- The order comes from the ZIP PET through the shipped `releaseOrderFromPet`. Results come from the ZIP PDF through the shipped parser and `releaseResultFromParsed`. The profile values are taken from the ZIP RES itself.
- Outbound destinations saved: Worker test, approval, activation. The transfer is frozen to `SYNTHETIC-SETTINGS-<revision>`.
- The RES file name equals the ZIP name. The encoding is UTF-16LE with BOM and CR separators.
- Every record and field equals the ZIP `2622270001105.res` **except P[7]**:
  - the legacy sample writes the DOB as `1983-02-02`;
  - NIPT-CBH writes the PET form `19830202`;
  - receiver acceptance is Hospital IT question Q-I5, and the code was not changed.
- `.ok` is byte-equal to the ZIP `.ok` (`ff fe`). The PDF is byte-equal.
- Order of operations: `PDF_VERIFIED`, then `RES_VERIFIED`, then `BACKUP_VERIFIED`, then `OK_OBSERVED`. The backup manifest holds the fingerprint.
- Running the same transfer again writes nothing and keeps sequence 1.
- A destination outside the allowed root fails the Worker test and cannot be approved.
- A destination removed after activation gives `RETRY_PENDING` with `SHARE_PATH_NOT_FOUND` on the monitoring panel and no `.ok`. Retry then completes.
- The status is always `hisConfirmed=false` (`AWAITING_CONFIRMATION`).
- `enabled=false` refuses binding a send (`EXPORT_DISABLED`).
- Operational consumer (`tests/db/operational-results.test.ts`): a real release is refused for:
  - an active configuration without a certifier HIS mapping (`CERTIFIER_HIS_MAPPING_REQUIRED`);
  - an active configuration without production authority (`OPERATIONAL_OUTBOUND_CONFIGURATION_REQUIRED`).

  The valid configuration then delivers RES, PDF and OK, still `hisConfirmed=false`.

**Browser** (`tests/e2e/settings-operational.spec.ts`, isolated runner, Axe AA clean): all done by clicking the Settings UI as two people (`synthetic.admin` saves and runs the Worker test, `synthetic.approver` approves and activates).
1. **General.** A new system name shows on every page after reload.
2. **Out-of-range value** (browser limit removed on purpose). The server refuses it, and the page names the field: "ค่าที่กรอกไม่ถูกต้อง: ถือว่า Worker ขาดการติดต่อเมื่อเกิน…".
3. **HIS inbound, folder A.**
   - Saved, then the Worker test shows "Daily Folder: 1 · PET/OK: 1", then approval and activation.
   - The running Worker reads the de-identified ZIP PET, and the case appears as received in the Lab worklist at the PET's P[21] time.
4. **HIS inbound, folder B.** Folder B is read; a PET placed in folder A afterwards is not received.
5. **HIS inbound, missing path.** It shows "ไม่พบ Path หรือไฟล์" and nothing can be approved.
6. **HIS outbound.**
   - The Worker test writes synthetic RES, PDF and OK plus a backup into the configured folders: `.ok` = `ff fe`, RES with BOM, and "HIS Confirmed: false".
   - A destination outside the allowed root shows "Path อยู่นอก Allowed Root หรืออนุญาตซ้ำกัน" and cannot be approved.

## 4. Settings acceptance matrix

**Legend:**
- **UI**: editable through the labelled Settings form.
- **Act.**: maker-checker lifecycle. GENERAL is test + activate. CLINICAL and INTEGRATION need test + a second approver.
- **ZIP**: the legacy equivalent.
- Test files:
  - `zip` = `tests/db/settings-zip-simulation.test.ts`
  - `cons` = `tests/db/settings-consumers.test.ts`
  - `e2e` = `tests/e2e/settings-operational.spec.ts`
  - `opres` = `tests/db/operational-results.test.ts`
  - `p5a` = `tests/db/p5a-auto-link.test.ts`

**Status words:** PASS, PARTIAL, FAIL, UNVERIFIED, EXTERNAL ACCEPTANCE, NOT APPLICABLE (not a value that steers a workflow now; the reason is given).

**Missing evidence found and added in this round:**
- Inbound `enabled` (switch-off) — added to `zip` B.
- Outbound `enabled` (switch-off) — added to `zip` D.
- Certifier HIS mapping / production authority (missing-value refusals) — added to `opres`.
- The Worker-in-use display — added to `zip` B and `e2e`.

| # | Setting | UI | Act. | Actual consumer | ZIP / Owner contract | Positive test | Negative test | Status |
|---|---|---|---|---|---|---|---|---|
| 1 | `general.systemName` | ✓ | test+activate | `src/app/(protected)/layout.tsx` (Sidebar) | — | `e2e` 1, `cons` 1 | 81 chars, wrong role, rollback (`cons` 1) | PASS |
| 1 | `general.timezone` | locked | — | Code always Asia/Bangkok | — | schema literal | `UTC` refused (`cons` 1) | NOT APPLICABLE (locked) |
| 2 | `request_consent.templateVersion`, `.mode` | read-only | refused | **none** | — | — | propose refused `SETTING_RUNTIME_CONSUMER_UNAVAILABLE` (`cons`) | NOT APPLICABLE — functional gap: no consumer. Needs OD-06 / DCC; not created here. |
| 3 | `doctor_registry.version` | read-only | refused | **none** (the doctor registry itself is the maker-checker page `/doctors`) | — | registry tests `tests/db/p2*.test.ts` | propose refused (`cons`) | NOT APPLICABLE (version field). Registry: PASS by existing tests. |
| 4 | `security.*` (30 min idle / 8 h / 5 attempts / 15 min) | locked | — | `packages/security/session.ts` (`IDLE_MS`, `ABSOLUTE_MS`, `LOCKOUT_ATTEMPTS`, `LOCKOUT_MS`) | — | literal = code constant (`cons` 4) | other value refused (`cons` 4) | PASS (locked) |
| 4 | Users / roles / units (not catalog keys) | admin pages | access request: proposer + independent checker | `role_assignment` / `user_unit_scope` → `authorize()` | `users_routes.py`, `ward_master.csv` | `tests/db/admin-settings.test.ts`, `admin-security-review.test.ts` | self-approval and stale version refused (same) | PASS (DB). Browser not re-run in this round. |
| 5 | `his_inbound.basePath` | ✓ | test (Worker) + approve | `packages/jobs/his.ts` `executeInboundJob` → `openInboundSource` → `discoverInbound` | `path_request` day folders, read-only | `zip` A/B, `e2e` 3 | missing, outside root, wrong account, old config (`zip` B, `e2e`) | PASS |
| 5 | `his_inbound.enabled` | ✓ | ” | `packages/jobs/worker.ts` cycle + `executeInboundJob` | `pet_autoimport_enabled` | `e2e` (Worker scans after activation) | `SCAN_DISABLED` (`zip` B) | PASS |
| 5 | `his_inbound.intervalSeconds` | ✓ | ” | Worker cycle (re-read every cycle), back-off, health staleness | `pet_scan_interval_min` | `e2e` (5 s; scan seen without restart) | range 5–3600 (`cons`, error message) | PASS |
| 5 | `his_inbound.lookbackDays` | ✓ | ” | `lookbackFolders` in discovery and connection test | `pet_scan_days_back` | `zip` A (2 days picks yesterday's folder) | range 1–90 | PASS |
| 5 | `his_inbound.section` / `testCode` | locked | — | `discovery.ts` section filter, `parsePet` 70096 | section 7 / 70096 | `zip` A (3 non-NIPT not stored) | — | PASS (locked) |
| 5 | `his_inbound.secretRef` | ✓ | ” | `openAuthorizedDirectory` (must equal the policy grant) | — | null with simulator / test share | mismatch refused (`tests/unit/his-paths.test.ts`) | EXTERNAL ACCEPTANCE (real credential is IT's) |
| 6 | `laboratory.pendingGovernanceGate` | ✓ | test + approve | `packages/lab/core.ts` `pendingPolicy` → gate → worklist READY / GATE_BLOCKED | — | `cons` 6 | HOLD blocks again (`cons` 6) | PASS |
| 6 | `laboratory.templateVersion` / `formulaVersion` | read-only | refused | frozen into batch metadata only | OD-34 / 28 / 29 | — | `CONTROLLED_METADATA_READ_ONLY` (`cons` 6) | NOT APPLICABLE (controlled metadata) |
| 6 | `laboratory.partialBatchAllowed` / `halosDataRows` | locked | — | lab / HALOS code | LD-13, OD-35 | existing P4 / HALOS tests | other value refused (`tests/unit/settings.test.ts`) | PASS (locked) |
| 7 | `result_management.pdfSourcePath` | ✓ | test (`resultFolderSettingValid`) + approve | `packages/results/jobs.ts` / `folder.ts` | `path_pdfresult` | `zip` C (switch a→b) | missing folder cannot be approved (`zip` C) | PASS |
| 7 | `scanSubfolders`, `acceptZip`, `maxFilesPerScan`, `maxUploadMb` | ✓ | ” | `scanResultFolder`, `previewFolderFiles`, `parseIntake` | `scan_pdf_folder_new`, `pdf_parser.py` | `zip` C | `zip` C (ZIP refused, `TOO_LARGE`, truncated) | PASS |
| 7 | `scheduledScanMinutes` | ✓ | ” | Worker → `queueScheduledScan` (list only) | `auto_scan_min` | `tests/db/p5-a14-a23.test.ts` | `SCHEDULED_SCAN_LIST_ONLY` (same) | PASS |
| 7 | `gaToleranceDays` | ✓ | ” | `crossCheck` (RG-04, link cross-check) | — | `cons` 7 (7 days MATCH) | 3 days MISMATCH (`cons` 7) | PASS |
| 7 | `linkageMode` (P5-A) | ✓ | ” | `autoLinkUnique` at import and from the one-click button | `matcher.py` (legacy auto-link by HN) | `p5a`, `zip` C | §5 | PASS |
| 7 | `picVersion` | ✓ | ” | synthetic-mode template gate. Operational mode uses QC5. | OD-07 | existing P5 gate tests | — | PARTIAL (OD-07 HOLD) |
| 7 | `certificationMethod`, `sexDisclosureRule`, `postReleaseRecollection`, `noticeChannel`, `releaseAuthority` | locked | — | display of Owner HOLD decisions. Enforcement is in code (RG-11, `p5_release_authorized()`, OD-17 void-first). | OD-05/09/17/07, AL-5 | existing P5 gate tests | — | NOT APPLICABLE (Owner HOLD; read-only) |
| 7 | `historical_backfill.*`, `go_live_cutoff` | ✓ | test + approve | `packages/historical/service.ts` | — | `tests/db/p5h-bulk.test.ts`, `tests/contracts/p5h-native.test.ts` (activate, then historical evaluation) | not re-tested in this round | PASS (consumer, existing P5H tests). OD-18/19 are Owner decisions. |
| 8 | `his_outbound` RES / PDF / backup paths | ✓ | test (Worker writes and reads back) + approve | `outboundDraftSettings` → frozen transfer → `packages/p6/sandbox.ts` / `worker.ts` | `path_resoutput`, `path_pdfrename`, `NIPTresfileBackUp` | `zip` D, `e2e` 6, `tests/db/his-settings.test.ts` | outside root, removed folder → retry (`zip` D, `e2e`) | PASS |
| 8 | `his_outbound.enabled` | ✓ | ” | `bindActiveOutboundSettings`, `reserveReleasedResult` | — | `zip` D | `EXPORT_DISABLED` (`zip` D) | PASS |
| 8 | `target`, `productionAuthorized` | ✓ | ” | `reserveReleasedResult` (operational only) | — | `opres` | `OPERATIONAL_OUTBOUND_CONFIGURATION_REQUIRED` (`opres`) | PASS (consumer). Real share is EXTERNAL. |
| 8 | `resultStyle` | ✓ | ” | `resultText()` in RES R[3] | `nipt_result_style` | `zip` D (`full` = ZIP R[3]); goldens `tests/contracts/p6-res.test.ts` | — | PASS |
| 8 | `retryLimit`, `retryDelaySeconds` | ✓ | ” | frozen `retryDelaysMs` → P6 back-off | — | `zip` D, `tests/db/his-settings.test.ts` | retry after failure | PASS |
| 8 | `confirmationTimeoutSeconds` | ✓ | ” | frozen `confirmationTimeoutMs` → `UNKNOWN_TIMEOUT` | — | `tests/db/p6-workflow.test.ts`, `tests/contracts/p6-transfer.test.ts` | timeout never counts as confirmed | PASS |
| 8 | `resProfile` | ✓ | ” | RES H/P/O/R fields | `hl7_*` settings | `zip` D (profile from the ZIP RES); `opres` | invalid profile refused (`tests/unit/settings.test.ts`) | PASS (contract). HIS acceptance is EXTERNAL (AL-6). |
| 8 | `certifierHisMappings` | ✓ | ” | `reserveReleasedResult` R[10] | `hl7_operator_id` | `opres` | `CERTIFIER_HIS_MAPPING_REQUIRED` (`opres`) | PASS (consumer). Real HIS IDs are EXTERNAL. |
| 8 | `round2SpecimenDatePolicy` | ✓ | ” | `reserveReleasedResult` P[23] for rounds ≥ 2 | none (legacy had no S2) | `tests/contracts/p6-transfer.test.ts` | null stops (`ROUND2_SPECIMEN_POLICY_UNRESOLVED`) | EXTERNAL ACCEPTANCE (Q-I5) |
| 8 | `his_outbound.secretRef` | ✓ | ” | `openAuthorizedDirectory` | — | null with test share | mismatch refused | EXTERNAL ACCEPTANCE |
| 9 | `storage_backup.retentionDays` / `target` | read-only | refused | **none**; installation owned (`FILE_STORE_ROOT`, IT backup service) | — | — | `INSTALLATION_OWNED_SETTING` (`cons`) | NOT APPLICABLE (installation-owned) |
| 10 | `notifications.staleSeconds` / `backlogWarning` | ✓ | test+activate | `src/server/health.ts` `systemHealth` thresholds | — | `cons` 10 | 30 s refused with field name (`cons` 10, `e2e` 2) | PASS |

**Not fully provable here:**
- Category 2, ANC request/consent: there is no global consumer, and creating one needs OD-06 / DCC.
- Category 9, backup: installation-owned.

These are reported, not "fixed", because making them work would mean inventing a workflow.

## 5. P5-A — migration 100 and acceptance

**Migration.** `db/migrations/100_p5a_unique_auto_link.sql` is forward only. Migrations 050 and 051 are not edited. Before replacing any constraint, it checks the constraint's name and exact definition, and stops (`MIGRATION_100_UNEXPECTED_CONSTRAINT`) if they differ. It adds:
- `result_link_event` event `AUTO_LINKED`, mode `AUTO_UNIQUE`, and `match_evidence`;
- version link mode `AUTO_UNIQUE` (`AUTO_PIC` stays prohibited).

**Database guards:**
- The link must target an unlinked final result.
- The series for that round must be empty.
- The target must be the current round and its latest attempt, and not historical.
- There must be no earlier human decision (proposal, rejection or unlink) and no open proposal.
- Evidence must be present, with `candidates = 1`, and the outcome must be `Linked`.
- A version can carry `AUTO_UNIQUE` only together with its matching event.

**Service:**
- `autoLinkUnique` runs only when `result_management.linkageMode = UNIQUE_AUTO_LINK`. The default is `MANUAL_REVIEWED_ONLY`, so turning P5-A on is one maker-checker Settings step.
- It runs at import confirmation and from the "เชื่อมโยงรายการที่ระบบจับคู่" button.
- The candidate search covers **all** non-historical cases, not the user's unit scope, so a hidden second patient can never make a match look unique.
- The match is evaluated again after the LN → round → attempt → version locks.
- A lost race leaves the version Unlinked, with an audited `RESULT_AUTO_LINK_SKIPPED` reason. The import still succeeds.
- It never reviews, certifies, releases or sends. The authorised "ตรวจรับ PDF และยืนยันส่งผล" (P5-B) is still required.

**Evidence:**

| Case | Result | Test |
|---|---|---|
| Positive | Linked with `AUTO_UNIQUE` evidence (HN + lab number + DOB, pregnancy, collection date and GA all MATCH). No second person. RG-03 `LINKED_AUTO_UNIQUE`. 0 releases, 0 outbound jobs. | `p5a` |
| Setting off / rollback | Default stays two-person. Rollback to the P5-A revision acts only after a new test and approval. | `p5a` |
| Negative | Shared HN; another lab number (legacy `26P…`); wrong DOB; re-draw notice — all Unlinked, with reasons | `p5a`, `zip` C |
| Duplicate | Same bytes give `Duplicate`. A second report for the round gives `SERIES_NOT_EMPTY`. A same-name report gives `NAME_CONFLICT`. | `p5a` |
| Concurrent | Two PostgreSQL sessions import two PDFs for one round at the same moment: 1 link, 1 Unlinked, both imports succeed | `tests/contracts/p5a-auto-link-native.test.ts` |
| Human decision | After an unlink, the system never links again; the two-person path is unchanged | `p5a` |
| Database bypass | Direct inserts are refused by every guard | `p5a` |
| Upgrade | Populated 099 database with proposal, rejection and approval history: rows unchanged, checksum recorded, re-apply is a no-op, unexpected pre-state stops | `tests/db/migration-100.test.ts` |

**Applied only to:**
- fresh PGlite databases;
- one fresh native database, `nipt_synthetic_test_p5a_*`, dropped after the test;
- the isolated runner's per-run synthetic database.

It was not applied to Integrated UAT, the UX-V2 preview or any real database.

## 6. Fixes made in this round (before → after)

| # | Problem found by running it | Before | After | Regression test |
|---|---|---|---|---|
| F1 | **A PET with no citizen ID** (ZIP fixture `2622370099`, legacy `test_empty_citizen_id_ok`) was rejected in operational mode. | `INVALID_PATIENT_IDENTITY` parse error, so the sample could never be received. Staff cannot receive S1 in NIPT. | Parsed as in the legacy parser. Matching still uses LN + HN; a present ID is still validated; the stored identity key is `null`. | `zip` A, `cons` 5. A mutation that restores the old rule fails `zip` A. |
| F2 | **Settings refusals were one generic message** ("ทำรายการไม่สำเร็จ…"). This covered out-of-range values, missing approval and a wrong lifecycle step. | The person could not tell what to fix. | `src/server/settings-errors.ts` names the labelled fields of a schema error and explains each lifecycle code. 401 and 403 are unchanged. | `cons`, `e2e` 1 |
| F3 | **No proof that the running Worker uses the active inbound configuration**, and no last-scan error on the Settings page. | Only test-connection results were shown. | The HIS panel shows the revision the Worker last used, a warning while it differs from the active one, and the last scan's outcome, error, unreadable-PET count and waiting-`.ok` count. | `zip` B, `e2e` 3 |
| F4 | `result_management` folder validation lived inline in the API route. | Could not be tested; synthetic mode skipped the marker check that the Worker applies. | `resultFolderSettingValid` (same access rules as the Worker) is used by the route and the tests. | `zip` C |
| F5 | P5-A could only propose. | Two people for every link. | See §5. | §5 |

**Refactors without a change in behaviour** (so the simulation exercises the shipped code):
- `releaseOrderFromPet` / `releaseResultFromParsed` extracted from `reserveReleasedResult`;
- `LOCKOUT_ATTEMPTS` exported.

## 7. Limits and what remains for QA, HIS, printer and governance

- **Hospital IT / HIS (AL-6):**
  - real share paths, ACLs and service account;
  - HIS acceptance of RES fields, including the DOB form in P[7] (sample `1983-02-02` vs NIPT-CBH `19830202`);
  - certifier HIS IDs;
  - round-2 P[23] (Q-I5);
  - any HIS acknowledgement.

  A loopback simulation is not HIS acceptance.
- **External report format:** the ZIP's BGI PDFs are text-only samples. The real report layout and the lab number printed on it are not proven.
  - The legacy samples carry BGI numbers (`26P…`/`26B…`) that are not NIPT-CBH LN Halos, so P5-A would leave such reports for manual linkage.
  - Which number the external program prints is a Lab / IT confirmation.
- **Owner / DCC:**
  - request/consent global settings (OD-06);
  - picVersion / PIC (OD-07);
  - OD-05/09/17 literals;
  - backup is installation-owned.
- **Physical:** label printing (Q-I7).
- **Governance:** OD-04 / P5-B Clinical Governance sign-off.
