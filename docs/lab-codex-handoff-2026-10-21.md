# Codex Handoff — NIPT-CBH LAB-01..LAB-13 to Local Owner UAT

## Latest consolidated ANC Owner closeout — 2026-10-23

The authorized ANC batch has **25/25 checklist items PASS**, with [current evidence, exact revision boundaries, review cases and Start/Stop commands](anc-owner-consolidated-evidence-2026-10-23.md). OWNER-UAT remains **PENDING**. Application code `ea12d61`, validated clean runtime `de1b701`; final documentation/test-only closeout SHA and all3 runtime SHAs are recorded after commit in `.local/anc-owner-closeout-20261023/final-delivery.json` / `FINAL-REPORT.md`. READY requires that exact final manifest to pass, all11 features INCLUDED and no MISSING/BLOCKED. Earlier source/snapshot/READY notes below are historical.

73 focused tests and2 disposable Native PostgreSQL suites PASS; actual Browser signing/same-case return/2-page signed PDF/authorized review and Restart/Persistence PASS. Full run2378P/1 obsolete-SCA-assertionF/59S; after correcting only that outdated test, its full4-test file passes and reconciled unique coverage is2379P/0unresolvedF/59S. [All59 SKIP conditions/names/risks](anc-owner-regression-skips-2026-10-23.md); raw failure and targeted correction are retained, not represented as a second full-suite run. No application code changed after the full run.

Original60cases/77files retained; own new synthetic ANC fixture makes61cases. Frozen-baseline restart preserves all22 DB hash groups and79files; post-restart login/Auto timestamp/case/PDF PASS. No new/changed migration or real go-live cutoff. Sidebar/top-nav suggestion is excluded pending approval. No push/merge/deploy/hospital/EXE work.

2026-10-21 | Owner AUTHORIZED Codex to implement and test on Development PC. **No hospital server or EXE upgrade yet.**

## Source completeness audit supersedes earlier snapshot notes

Use clean `.local/source-complete-uat` and the mandatory preflight/delivery gate. The pending Owner top scrollbar and real-service ANC DB tests are now included; all original dirty/untracked files were individually reviewed. `servicesReady` is technical health; `ready` also requires exact source/runtime hashes and all10feature checks. [Audit review/commands](source-to-runtime-completeness-audit-2026-10-22.md); final exact SHA/results are `.local/source-parity-audit/FINAL-REPORT.md` / `final-delivery.json`. Earlier snapshots below are retained historical evidence. OWNER-UAT=PENDING.

## Current runtime — existing LN links/highlights restored (2026-10-22)

**c7cba91bdf79ae3673193b9d9b6689cc413f9209**, clean `.local/ln-highlight-uat-source`, is the latest loopback UAT and includes prior date/Toast patches. Existing Owner UI changes were preserved but omitted from prior clean builds; scoped restoration now includes overview/registry LN anchors and row highlights. ANC/LAB actual mouse/keyboard navigation and Desktop/Mobile Light/Dark checks PASS,22affected tests PASS, health ready=true,60cases/16artifacts preserved. [Evidence and current launch commands](ln-highlight-restoration-evidence-2026-10-22.md). Separate scrollbar/ANC DB-test dirty edits remain preserved in primary; no reset. **OWNER-UAT=PENDING.** Earlier runtime notes below are historical evidence.

## Current runtime update — Owner-approved save Toast (2026-10-22)

Current Local UAT is **`afd67341278c80c54629f808fa7eca4c16aca68e`**, clean `.local/save-toast-uat-source`, extending the ANC date patch below. Owner approved dismissible “บันทึกสำเร็จ” Toast,3seconds, with autosave remaining inline. Affected tests47PASS, typecheck/lint/guard/build, actual ANC Browser ACK/failure/autosave/mobile/dark/axe checks PASS; final health ready=true. All3service SHAs match;60cases/4batches/3releases/16artifacts preserved. [Toast evidence and current launch commands](save-success-toast-evidence-2026-10-22.md). Earlier SHA/test statements below are retained evidence for those revisions. **OWNER-UAT=PENDING.**

## Current runtime update — ANC Owner Change 9 (2026-10-22)

The subsequently authorized ANC date patch is **`b14a4ea331872a15c4011fbc73482bfa57184122`**, parent LAB baseline56175de. Current loopback UAT web/worker/renderer use clean `.local/anc-date-uat-source` at that patch SHA. Date affected tests115PASS, typecheck/lint/guard/build and real ANC Browser/API/PostgreSQL/PDF/restart PASS; health ready=true. Existing59cases/artifact16 preserved, one new synthetic ANC date case makes60. Full Regression2364/0/62 below remains **baseline evidence**, not a rerun on the patch. See [separate date evidence](anc-thai-date-owner-change-9-evidence-2026-10-22.md) for current Start/Stop/Health commands and exact evidence. Baseline snapshot remains intact; original unrelated dirty changes remain excluded. **READY FOR OWNER TEST; OWNER-UAT=PENDING.**

## Final closeout — 2026-10-22

**READY FOR OWNER TEST (Local Development only). OWNER-UAT=PENDING.** All58 in-scope LAB implementation/Local UAT checklist items PASS with evidence; Owner acceptance checkbox remains unchecked.

- Source, clean runtime snapshot and retained Full Regression revision: **56175ded59b9624768d2f157c520b0505dd67404**. Baked web/worker/renderer and migration inventory match. Primary worktree keeps the five original unrelated user changes; runtime uses `.local/lab-uat-source` without those uncommitted ANC edits.
- Full Regression: **2364 PASS / 0 FAIL / 62 SKIP**,176 passed files/20 wholly skipped,693.50s. Native PostgreSQL3 suites PASS separately. No Full Regression rerun during closeout. SKIP is not PASS: `docs/lab-codex-skips-2026-10-22.md` lists every skipped test, conditions and risks; default DB opt-ins17, P6 native33, P7 native1, legacy/ZIP fixtures6, Native Excel1, DCC/installer3, explicit Master path1.
- Final health: `.local/lab-owner-evidence/owner-closeout-health.log`, ready=true, FRESH worker, renderer200, native Excel bridgeIDLE, Master SHA verified, loopback only. Restart and Browser re-login retain59 cases/4batches/3releases/16 verified stored artifacts; initial6 cases preserved.
- Browser evidence covers operational PET→LN/Label→Task Lists→QC→Pooling/CSV→Seq→both XLSX→PDF/independent review/authorised local release, Singleton/Twin/S2/urgent/D13, Manual CSV+ZIP/identity review, NOTICE blocked release and duplicate safeguards. Final native Excel PDF Preview1A4 works. UI42 responsive/light/dark captures have0 axe/overflow/page errors; QC Tab focus2px confirmed.
- `LAB_MANUAL_COMPLETE` records verified paper stages and reviews existing Final PDFs independently of P5H Promotion, without new PET/QC/clinical certification. Only real-go-live-dependent P5H Historical Case Promotion remains **BLOCKED**. No actual cutoff set. Disposable synthetic P5H test configuration is separate. Real completed patient PDFs were not migrated by the synthetic Manual001 support test.
- No push/merge/deploy/hospital access/Upgrade.exe. No further implementation or packaging phase until Owner tests and explicitly instructs it. Documents remain updated in the worktree; no document-only commit changes HEAD56175de or its validated runtime/test identity.

### Owner entry and review

Open **https://127.0.0.1:19548/login** on this Development PC. Use `uat.lab` for Lab work and `uat.certifier` for independent review. Passwords remain only in the ACL-protected `.local/owner-local-uat-1.0.2/credentials.txt`; never publish them.

From PowerShell7 at the worktree root:

```powershell
& .\tools\operational\Home-UAT.ps1 -Action Start -SourceSnapshot '.local/lab-uat-source'
& .\tools\operational\Home-UAT.ps1 -Action Health -SourceSnapshot '.local/lab-uat-source'
& .\tools\operational\Home-UAT.ps1 -Action Restart -SourceSnapshot '.local/lab-uat-source'
& .\tools\operational\Home-UAT.ps1 -Action Stop -SourceSnapshot '.local/lab-uat-source'
```

Start/Health/Restart were executed; Stop is the reviewed scoped Compose/native bridge stop and retains volumes. Docker Desktop/native Microsoft Excel/PowerShell7 were verified. Keep the source snapshot at56175de while reviewing this candidate.

Owner test cases: inspect Run001 saved QC48+9/Pooling exclusions2,7,13,40/Seq and both downloads; urgent Batcha205fbdd-092b-4430-9e44-3ddb1a95fecb includes actual40; slot13 Batch9aaf4e3b-bb0e-49d7-9fb1-78c53ab03d26 includes physical13; S2 Batchaf1cf2c5-bce6-4462-85d7-4bd524047c4a uses its new PET times and same base LN/R lineage. Results LN9903001002 Singleton,9903001001 Twins,9903001045 S2 remain available. Manual Batch51aee842-ab09-4335-8e29-53c25103b702 contains the separately reviewed test PDFs/paper markers. Check Preview/printing/downloads, theme/keyboard, role boundaries and restart retention using these retained test cases.

Physical printer/scanner, HALOS/BGI hardware import, real Hospital LAN/UNC/HIS ACK and clinical acceptance remain NOT RUN. Local outbound files keep hisConfirmed=false. The62 skipped tests retain their exact coverage limits; this readiness is for Owner Local UAT only.

Latest Owner Manual decision (2026-10-22): no real go-live cutoff during Local UAT. Separate `LAB_MANUAL_COMPLETE` intake/paper markers/Final PDF identity/independent authorised review from P5H Historical Case Promotion. Only the actual real-go-live-dependent promotion may remain BLOCKED. Never set a test/current date in Persistent Owner UAT; disposable synthetic P5H tests may use explicitly test-only configuration. No invented PET/QC or new certification/release for already completed Manual work. Forward119 review and120 repeat guard are applied; native Browser/Restart evidence is complete for final56175de. Owner hands-on acceptance remains PENDING.

## MANDATORY, before any source changes
- Worktree: `D:\Claude workspace\NIPT-CBH-PARITY-REMEDIATION`, branch `fix/consolidated-parity-101`.
- P0 **FINISHED**. Do not restart/reimplement P0. Protect unrelated uncommitted ANC/CSS/test edits and untracked Owner notes.
- Read `AGENTS.md`, `docs/lab-workflow-owner-lock-2026-10-21.md`, and **every item** of `docs/lab-codex-checklist-2026-10-21.md`.
- Find and verify real user-supplied templates: `Final New_Task_List_1-3.xlsx`, `Pooling Sheet Template_R001.csv`, `NIFTY_Test_Request_FormHNZ_filled.xlsx`, NIPT `.PET`, approved six-sheet combined Master. Compare structure, mapped cells, formulas, formatting and hash **before implementing**; never overwrite originals. NIPTY reference source: `C:\Users\User\OneDrive\Desktop\NIPT-Audit\NIPTY_handover`.
- Honor all Owner-Locked decisions, including two LAB registrations (manual already-PDF vs lab received-paper/PET), **automatic receipt on matched HIS PET with no confirmation button**, Order/Collection/Received timestamps `P[21]` / `P[23]` first / `P[23]` second, monthly LN Halos, label, Task List 1–3 paper, QC 48 + 9 standards, formula-driven Pooling/CSV, Seq paper/XLSX, results matching and approval. Keep patients first and PC/NC at end of Seq export; BLANK at slot40 default with optional urgent patient replacement. No second guessing.
- User interface via `ux-ui-promax` and `impeccable`. No visible synthetic/mock/developer labels in operational UI and no simulation-only logic behind false clean labels.

## THE ORDER IS TO EXECUTE, NOT JUST PREPARE ANOTHER PLAN
Implement **every** checkbox in the checklist, add direct regression tests, run tests, fix failures, bring up independent **Local UAT on this Development PC** and verify in real browser with synthetic fixture data. Show precise evidence per item and keep checklist/evidence updated.

Baseline: read Git status and preserve user edits. Required gates include typecheck, lint, guard, unit, DB (native PostgreSQL and worker, not PGlite only), permissions, contracts, build, relevant E2E; true native Excel print 2 A4 pages per Task List; Pool CSV A/F-only integrity and <2µL to 0, Pool red thresholds <3.00/>3.60, Seq XLSX column/row/fixed-value/template fidelity, browser full journey for both Lab registration routes, S1/S2 and result/PDF/RES/OK local-only, local persistence after restart.

Existing local UAT launchers: `tools/operational/Home-UAT.ps1` and `tools/operational/Local-Owner-UAT.ps1`. Existing runtime is designed for `https://127.0.0.1:19548`, but **prove its actual health and URL** before reporting. Launcher requires a clean commit, branch, and master hash; do not cheat by wiping files, deleting databases or bypassing safety checks. Only commit carefully selected, explicitly scoped files if required to start this isolated UAT; no remote push.


## OWNER LATEST QC POLICY OVERRIDE — 2026-10-22
Owner explicitly rejected the **old** QC rules and said **new rules prevail**. Read section 6 of the Owner Lock and QC POLICY OVERRIDE in Checklist. For QC1 use Owner Master: patient/PC/NC ≥2.00 ng/µL, BLANK ≤0.60; WI 3–50 is obsolete and cannot block a new-workflow QC1 decision. QC2 Pool range is 3.00–3.60 with red outside; per-slot Volume <2 red and CSV F=0, separate rules. For QC3/QC4 record/review actual values under latest Master; no invented numeric thresholds, no blanket BLOCKED due to old WI/OD31, and no unverified clinical AUTO PASS. Remove old conflicting UI/gates narrowly, preserve actual clinical identity, reviewer and result release protections. Continue the complete local UAT work; do not request reconfirmation.

## STRICT NO-GO RULES
- NO work outside LAB-01..13 or necessary exact integration/regression tests. Do not alter ANC 1–32, completed P0, unrelated portals, APIs/DB, design framework, packages, or authentication without strictly necessary LAB dependency and evidence.
- NO new Owner decisions inferred by Codex, no additional confirmations/approvals, no substitute clinical thresholds, formulas or fixtures passed off as real measurements.
- NO deployment, server login, live HIS integration, production database, secrets disclosure, remote push/merge, creation/installation/upgrade of any `.exe`.
- If real ambiguity cannot be resolved by accepted source/template/Owner Lock, mark only affected checkbox `BLOCKED – OWNER DECISION REQUIRED`, cite exactly what is ambiguous and continue unrelated checklist items. **Do not ask again about anything already decided.**
- A synthetic test pass does not mean real clinical/Owner approval. No fabricated HIS ACK or signed acceptance.

## DONE CRITERIA & HANDOFF
1. Each implementable checkbox is marked PASS with concrete command, observed result and evidence; all FAIL/BLOCKED remain clearly visible with reproduction, not ticked as done. Add `docs/lab-codex-evidence-2026-10-21.md`.
2. Local UAT can open and run entire agreed workflow with persisted sample/test data, accessible on the Development PC, tested without console/API errors. Supply tested URL, Start/Stop/Health, roles/credentials file **path only** (never password), representative generated test artifacts and SHA hashes.
3. Owner can start hands-on tests. Mark status **READY FOR OWNER TEST** only if demonstrated. `OWNER-UAT = PENDING` until Owner tests. Future upgrade `.exe` begins **only after** Owner accepts local UAT and gives a new instruction.
4. Do not stop at a plan, partial implementation, passing Build only, or a short progress report. Work through checklist fully within current authorized scope and truthfully report any truly blocked external prerequisites.

## Owner precedence lock (2026-10-22)
Owner: "ถ้ามีอะไรแบบนี้อีก ให้ยึดอันใหม่ที่สั่งให้ทำ ไม่ต้องหยุดถามอีก". Treat every newer **explicit** Owner instruction as overriding any conflicting prior rule/WI/old Master/earlier plan/HOLD within scope. **DO NOT ask again, stop the workflow or reopen a resolved decision** merely because older rules disagree. Implement and validate the new rule in the relevant source/UI/tests. If the new instruction does not specify a genuinely required novel value, don't invent it; log a narrowly scoped blocker while proceeding with other work. No broad bypass of patient identity, clinical review, release protection or expansion beyond LAB-01..13.


## NEW LAB-13 AMENDMENT — TWO XLSX PER SEQ EXPORT (2026-10-22)
Read **`docs/lab-seq-dual-export-owner-amendment-2026-10-22.md`** (LATEST Owner amendment at bottom) and complete Checklist F07,F08,F09,U09. ONE click makes two XLSX files. File1 NIFTY excludes BLANK and previous rerun/Seq patients, appends PC/NC, Q Department=`ANC` every row. File2 HALOS Task Import is **NOT fixed 48 rows**; keep the original **Task List slot numbers 1–48 in D** and export **ONLY actually pooled positions** in ascending slot order (e.g. BLANK40 unpooled => D ...39,41..., 47 members when all others pooled; urgent pooled at40 => can reach48; other unpooled slots removed without renumbering). Source example omitted Barcode13 by mistake: output D=13 iff slot13 pooled. A=real LN Halos/control ID, B=`L01`, C=`DNBYYYYMMDD` Bangkok click date each included row, E blank. Verify against accepted current Pooling/actual-transfer evidence; do not treat QC calculated volume/placement as proof or invent members. Preserve source workbook, guard controls/lineage; do targeted then final tests, and do not ask Owner to reconfirm.

## Owner update — NIFTY Column Q Department (2026-10-22)
**LATEST OWNER OVERRIDE: File #1 (NIFTY Test Request XLSX) only:** Set Column **Q (Department)** to the exact string **`ANC` on every exported data row**, including patient rows and the trailing Positive Control and Negative Control rows. This overrides whatever Column Q contained in the reference sample; preserve all other agreed fixed fields, row eligibility/exclusions, formatting and untouched columns. **File #2 HALOS Task Import is unchanged.** Update the exporter, backend contract, XLSX readback/byte-cell tests and real browser download assertions. Do not source Column Q from PET, site or UI; it is a fixed Owner value. No questions or new policy.
