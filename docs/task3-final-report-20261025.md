# NIPT-CBH Task 3 — ReadyGen Integration: Final Report (2026-10-25)

## 1. Source, runtime and parity

| Item | Value |
|---|---|
| Worktree / branch | `.local/task3-readygen` / `feat/task3-readygen-20261025` (from Task 1.5 `40a9c7e`; `1a4055a` is an ancestor) |
| Commits | `0ad0f22`, `1e4d004`, `09c6d7a`, `3e0b6f7`, `17dfa07`, `e26a07a` (+ this report's doc-only commit) — local only, not pushed or merged |
| Migrations | 128 `task3_readygen_two_pathways`, 129 `task3_native_no_call` (forward-only). UAT ledger: 72 rows, last 128/129, applied on PostgreSQL 17. |
| Integrated UAT | https://127.0.0.1:20128 (TLS proxy) → web 20127, renderer 20130, PostgreSQL 20129, all bound to 127.0.0.1. DB `nipt_task3_integrated_owner_uat`. |
| Parity record | Final UAT built and seeded fresh from **`e26a07a`, clean tree** (`gitDirty:false`); source-inventory SHA-256 `3e534ca8…` at `17dfa07` then rebuilt for `e26a07a`; Next build `XcOt28T1_8bMpGEyIj26k`; `server.js` SHA-256 `6b735ff7d534bdfe…`. Full record: `.local/task3-uat/runtime.json`. |
| Renderer | Microsoft Word 16 (COM, `ExportAsFixedFormat`) — the same engine ReadyGen uses. |

## 2. Source provenance (Owner-confirmed folder, read-only copies)

| File | SHA-256 |
|---|---|
| Singleton DOCX `FM-WI-T-BM-17-07` | `a56be6e4282b9b2fa06b4a73a527342c0949a70e83bef85a6574d379b4509117` |
| Twin DOCX `FM-WI-T-BM-17-08` | `0f7313213fbd99153ee015018df4cab013567ce12281a5a2102baad84ddd1bf3` |
| HALOS workbook | `bccade7d24779eb8f82a1723766324313314fa9e389a460b20bbdd6ce51dabed` |
| NIFTY Run 2 | `46569117780dd03224ee4262bd5db14a83697b477757804552592cc1223d556d` |
| Reference PDF (Singleton) | `cfc4b061a5a39879313c3fde32d382c92c970314ef889fef478d6be321c785a3` |
| ReadyGen `enrich.txt` | `66a519a6f75dd3edc6994661704bb1c2709ff9e9464406e0b9e72df723e8d5e3` |
| `ReadyGen.zip` / `ReadyGen.exe` | `d67fdf03…8355483` / `c9df0023…1f201` — unsigned; **never executed** |

The originals were never modified. The 45 real patient PDFs in the folder were not copied, committed or logged. `Pasted text(3).txt` and the Owner Addendum were not found and are recorded as missing.

## 3. Changes made after the Independent QA Gap Report (root causes)

| QA finding / defect found | Root cause | Fix |
|---|---|---|
| Native No Call Final missing (MISSING) | Report path held every No Call | Native No Call uses the same Owner master: result cells "No Call", Remark "Result = No Call", QC PASS/FAIL. Gated by the CLINICAL `noCallRenderingApproved` setting. Migration 129 accepts a `NO_CALL` record only with that approval and the live Task 1 No Call source. |
| No Call never releasable for the Owner lineage (found by the real R-2 test) | `confirmFailure` left the failed child's repeat order `RepeatInProgress`, so `task1_no_call_source` was NULL | Close the order `RepeatFailed` as the QC1 path does |
| Native No Call read-back failed | The masters' only free-text slot extracts as `Remark: Result = No Call` | Parser 1.0.4 also anchors that form; two Result lines still make the field UNREADABLE |
| Registration after render failed when the Request lacked DOB/EDD | The cross-check needs both, but preparation did not | Hold `REQUEST_DOB_NOT_RECORDED` / `REQUEST_EDD_NOT_RECORDED` before rendering |
| Offline verifier failed under a PowerShell 7 parent | Windows PowerShell 5.1 inherits the PS 7 module path; `Get-FileHash` is not found | Hash with .NET SHA256 directly |
| Escape in the PDF preview also closed/dirtied the report dialog | React propagates the inner `<dialog>` `cancel` event to the outer `onCancel` | The shared Dialog handles only its own cancel event |
| Internal release from the result page failed | The panel omitted the worksheet revision | Pass `benchEvidence.revision`, as the external path does |
| axe `link-in-text-block` (serious) | In-text link distinguished by colour only | Underline, matching the design system's table/registry links |
| `settings.test` count, `p5-results` parser version | The Task 3 keys were added; the test pinned 1.0.1 (already failing at baseline) | Explicit key list; compare with `PARSER_VERSION` |

Changes to accepted, pre-Task 3 source, each necessary:
- `packages/lab/intake.ts`: the repeat order fix.
- `packages/results/parser.ts`: the Remark anchor.
- `src/components/p2/shared.tsx`: the Dialog cancel scope.
- `src/components/p5/result-review.tsx`: the panel prop and the RG-14 heading.

## 4. Verification (exact runs)

| Suite | Result |
|---|---|
| Typecheck / lint | see §4a |
| Unit / permissions / db / contracts | see §4a |
| Native PostgreSQL (app_rw/worker_rw) | see §4a |
| Microsoft Word contracts | NP, NC (Singleton + Twin No Call), NEG, ID, GOLD, SRC, REC — PASS |
| Integrated browser E2E (UAT) | `tests/e2e/task3-integrated-uat.spec.ts` **6/6 PASS** on the fresh UAT of `e26a07a` (49.7 s): axe 0 violations on 7 pages incl. dark theme; 0/30 page-width captures overflow; view/download/print SHA identical; pathway B 0 outbound jobs; P6 exactly 1 transfer per internal release; ANC LAB APIs 403; APP_ADMIN Final 403 |
| Restart / persistence | stop → start without reseed: business counts identical; admin/admin login 200 |
| Backup / restore | `pg_dump -Fc` → restore into a scratch DB: same report/release/transfer/attestation/ledger counts |

### 4a. Regression counts

Run on `3e0b6f7` (clean tree); logs in `.local/task3-evidence/regression/`:

| Command | Result |
|---|---|
| `npm run typecheck` (next typegen + tsc) | EXIT 0 |
| `npm run lint` (`--max-warnings 0`) | EXIT 0 |
| `vitest tests/unit` | 85 files; 466 passed, 4 skipped |
| `vitest tests/permissions` | 3 files; 848 passed |
| `vitest tests/db` | 88 files passed, 3 skipped; 454 passed, 8 skipped |
| `vitest tests/contracts` (no native URL) | 30 files passed, 22 skipped; 717 passed |
| `vitest tests/contracts` with native PostgreSQL 17 (`NIPT_TEST_DATABASE_URL`) | 46 files passed, 4 skipped; 734 passed. 2 failed: `native.test.ts` (smoke-pet `NOT_APPLIED`) and `p3-native.test.ts` (smoke-p3-inbound TypeError) |
| `p6-native` + `p7-safety-native` (isolated `nipt_p6_synthetic_task3`) | 2 files; 34 passed |
| `task3-native-pg`, `task3-native-concurrency` (app_rw/worker_rw) | PASS |

The two native stack smoke failures are **pre-existing**. They were reproduced identically on the Task 1.5 baseline `40a9c7e` (its own 70 migrations, same environment, temporary worktree since removed), so they are not caused by Task 3. They concern P3 inbound smoke scripts outside the Task 3 scope and are reported, not fixed.

One more pre-existing failure was fixed: `tests/db/p5-results.test.ts` pinned parser `1.0.1` while baseline shipped `1.0.2`.

## 5. E2E evidence (synthetic, names masked)

`.local/task3-evidence/e2e/`:
- `task3-e2e-evidence.json`: axe per page; overflow per width; ZIP SHA-256; internal report rows with signer basis; pathway B (origin, PDF hash match, 0 outbound jobs, attestation effect); P6 one transfer per release; ANC same bytes for view/download/print; ANC negative statuses.
- Screenshots at 1440/768/375 and in dark mode.

## 6. Verdict

### 6a. Verdict

**TECHNICALLY READY FOR INTEGRATED OWNER UAT** — every implementer-executable item of the 108-item checklist is PASS with executed evidence (`docs/task3-completion-checklist-20261025.md`). This is **not** clinical, Owner or Production acceptance.

Disclosed and not counted as PASS: 2 pre-existing native stack smoke failures (P3; identical on baseline `40a9c7e`).

Pending gates that the implementer cannot execute or must not decide:

1. **EXT — actual ReadyGen offline E2E** (T3-01-04, T3-09-01, T3-12-13). This needs a trusted, licensed ReadyGen installation authorized by the hospital. The bundled unsigned exe was not run. The fixture PDF is not ReadyGen output.
2. **Clinical / Owner**: approval of ruleset CBH-READYGEN-REF 1.0.0, the HNZ0011 vs HNZ0051 product/template clearance, the No Call rendering, the twin Y disclosure rule (OD-09), and an approved Twin reference PDF.
3. **Owner**: NIFTY J/O column decision for the ReadyGen input, the single-signer policy, and hospital authorization of the outage SOP.
4. **Owner UAT and Production acceptance**: NOT RUN — AUTHORIZATION REQUIRED.

## 7. Known limitations (true, remaining)

- A 5th+ attempt reuses the printed ID `R-1` (Owner lock). When an older export holds the same ID, the HALOS row resolves AMBIGUOUS and stays held (fail-closed). That case uses pathway B with the existing two-person manual link.
- A No Call whose failed attempt has no HALOS row (pre-sequencing failure) cannot use the native report and uses the external No Call path (Task 1).
- LAB Paper cases cannot record a fetal-sex wish in Sample Detail. Singleton reports need the verified paper Request panel (existing RG-11 / OD-09).
- The P6 HIS share in UAT is a local folder; receipt by a real HIS is never inferred.
