# Source-to-Runtime Completeness Audit — 2026-10-22

**Source review/restoration and feature smoke PASS on first complete build. Final delivery is governed by the generated exact-revision report, not this static heading. OWNER-UAT=PENDING.**

Initial HEAD/runtime: `c7cba91bdf79ae3673193b9d9b6689cc413f9209`; clean runtime snapshot `.local/ln-highlight-uat-source`. No committed changes were missing at that starting revision. However, a clean SHA alone hid deliverable **uncommitted top ANC scrollbar**; its source was not in that snapshot. Earlier date/Toast snapshots had also omitted the already restored LN/highlight work. This audit treats every dirty/untracked file as review-required, not automatically unrelated.

## Every starting Git change and disposition

| File | Git | Disposition | Review / rationale |
|---|---|---|---|
| `src/components/anc/dashboard.css` | M | INCLUDED in delivery source | Owner-authorized top scrollbar UI; include after Browser sync/keyboard checks |
| `src/components/anc/dashboard.tsx` | M | INCLUDED in delivery source | Owner-authorized top scrollbar UI; include after Browser sync/keyboard checks |
| `tests/db/anc-dashboard.test.ts` | M | INCLUDED in delivery source | Real service/Consent fixture correction; 45 related DB tests PASS; no trigger bypass |
| `docs/anc-thai-date-owner-change-9-evidence-2026-10-22.md` | ?? | INCLUDED in delivery source | Existing Owner decision or evidence document; reviewed as reference/history, not new authority or clinical acceptance |
| `docs/lab-codex-checklist-2026-10-21.md` | ?? | INCLUDED in delivery source | Existing Owner decision or evidence document; reviewed as reference/history, not new authority or clinical acceptance |
| `docs/lab-codex-evidence-2026-10-21.md` | ?? | INCLUDED in delivery source | Existing Owner decision or evidence document; reviewed as reference/history, not new authority or clinical acceptance |
| `docs/lab-codex-handoff-2026-10-21.md` | ?? | INCLUDED in delivery source | Existing Owner decision or evidence document; reviewed as reference/history, not new authority or clinical acceptance |
| `docs/lab-codex-skips-2026-10-22.md` | ?? | INCLUDED in delivery source | Existing Owner decision or evidence document; reviewed as reference/history, not new authority or clinical acceptance |
| `docs/lab-seq-dual-export-owner-amendment-2026-10-22.md` | ?? | INCLUDED in delivery source | Existing Owner decision or evidence document; reviewed as reference/history, not new authority or clinical acceptance |
| `docs/lab-workflow-owner-lock-2026-10-21.md` | ?? | INCLUDED in delivery source | Existing Owner decision or evidence document; reviewed as reference/history, not new authority or clinical acceptance |
| `docs/ln-highlight-restoration-evidence-2026-10-22.md` | ?? | INCLUDED in delivery source | Existing Owner decision or evidence document; reviewed as reference/history, not new authority or clinical acceptance |
| `docs/owner-change-list-1-32-source.md` | ?? | INCLUDED in delivery source | Existing Owner decision or evidence document; reviewed as reference/history, not new authority or clinical acceptance |
| `docs/save-success-toast-evidence-2026-10-22.md` | ?? | INCLUDED in delivery source | Existing Owner decision or evidence document; reviewed as reference/history, not new authority or clinical acceptance |

The broad Owner1–32 document is retained as historical reference, not an instruction to restart P0 or expand this audit. Existing report READY/SHA statements are historical evidence; this audit gate supersedes their delivery status until final validation. Local protected credentials, data volumes, artifact files and `.local` diagnostic output are intentionally outside Git/source snapshots; they are checked separately, not discarded.

## Prevention

`tools/operational/pre-uat-source-parity.mjs` provides preflight/runtime/delivery checks. The launcher rejects dirty/unreviewed delivery files or HEAD/snapshot mismatch before Start/Restart. Technical `servicesReady` is distinct from `ready`; Health/Start only expose `ready=true` after exact-revision feature evidence and runtime parity pass. The new build provenance stores per-file SHA-256 (raw plus normalized UTF-8/LF text) and aggregate source inventory. Snapshot raw hashes must match all3 baked service manifests exactly. Applied migration names/hashes are read-only checked against bundled bytes and the repository's existing exact historical-pair compatibility; no arbitrary normalization of applied ledgers, new pair or migration edits.

Raw Windows encoding/EOL differences are listed separately with both hashes. They count as INCLUDED only if normalized source content is identical; content differences/unreviewed files are MISSING and fail. Untested feature evidence is BLOCKED, never PASS. Reviewed exclusions require an exact path/hash/reason; policy currently has no exclusions.

Evidence directory: `.local/source-parity-audit/`. `initial-git-status.txt`, `initial-diff.patch` preserve the initial audit. `initial-parity.json` lists **every differing file**, both hashes, dirty/untracked rows, starting runtime revisions, migration ledger and conservative missing/unverified statuses. The initial checker correctly returns FAIL. Current/Final machine reports will supersede it without overwriting the initial evidence.

## Validation scope

Required feature coverage: ANC highlight/LN, registry highlight/LN, top horizontal scrollbar,8digit BE date,save Toast,ANC Request/Consent,Lab registration/registry,QC/Pooling/Seq Task-G50,dual XLSX,PDF Preview/Result. Runtime smoke must exercise current UI and actual saved artifacts/API, not infer presence from unit tests or commit messages. Existing authorized synthetic cases/artifacts are reused; no fake clinical release/signature/QC evidence is created. Real hospital/device/clinical acceptance and real Go-live/P5H promotion remain separate external gates.

Affected checks so far: ANC/Consent/SQL DB45PASS and initial tool/date/UI23PASS; final counts and Browser/persistence results will be appended after validation. Full baseline2364PASS/0FAIL/62SKIP remains historical LAB evidence; no full rerun is planned because no analytical/workflow/migration logic changes.

## Observed restoration and complete-feature checks

First complete source/runtime build `3777eac3e0be34d3437a5a06af090ba4414d462a`: all3baked inventories match the clean snapshot; source canonical differences0; no committed changes missing. Scrollbar exists, scrolls bidirectionally with the table, supports ArrowRight and is hidden with the desktop table on375px mobile. Initial inline width was replaced with a ref/CSSOM width update to preserve behavior under the existing CSP without adding unsafe-inline.

| Required area | Observed status | Actual runtime check |
|---|---|---|
| ANC highlight and LN | INCLUDED | Focus highlight + LN Enter navigation |
| Registry highlight and LN | INCLUDED | Current scoped case navigation/highlight |
| Top horizontal scrollbar | INCLUDED (restored) | Overflow width, top/bottom sync both directions, keyboard,375px cards |
| Thai date8digits | INCLUDED | Request DOB/EDD typing, invalid date error, API saved Gregorian ISO |
| Save Toast | INCLUDED | Explicit Save displays dismissible Toast after form closes |
| ANC Request/Consent | INCLUDED | Current5category form, DCC2page draft, existing immutable signed Consent Browser PDF preview |
| LAB registration/registry | INCLUDED | Both paths visible, EDC MM/DD/YYYY CE retained, actual LAB LN click |
| QC/Pooling/Seq Task-G50 | INCLUDED |48QC positions, saved actual pooling loaded, saved DNB and export gate |
| Dual XLSX | INCLUDED | Current authenticated downloads, SHA equals immutable manifest; NIFTY Q=ANC on every data row; HALOS physical D equals pooled positions |
| PDF Preview/Result | INCLUDED | Native Excel1A4 Seq PDF renders in actual iframe; saved Final PDFs and2CertifiedReleased states read without new clinical actions |

Runtime smoke `.local/source-parity-audit/runtime-smoke.mjs` writes exact-revision feature evidence only after every check passes. At start it invalidates the current validation session; failures write FAIL so a previous PASS cannot hide a failed rerun. Feature records are not evidence of hospital/clinical/Owner acceptance.

The HALOS readback harness initially included D1's shared-string index3 as a physical position. Source/template inspection confirmed row1 is the Barcode header and data start at2; verification was corrected to read data rows/cell types and cell-boundary Q values. No exporter rules or data were changed to pass the audit.

Migration ledger63/63:62exact hashes plus migration105's **existing approved historical byte pair** (recorded `08c73fa1057aa3aadaa1b9420bd97499f0375dfa1e1691c6e480af389bdf8d80`, clean LF `b6707b701768d27b13eb70d2330489b8d5e66603008ef344abbaf71c53bb9f7c`). The checker reuses `tools/migration-checksums.ts`; ledger and migration files remain unchanged. Baked raw migration inventory remains `43f663d903641a33e0836c75b1ad45828215ba832f9b915bdefa900cbd50ce21`.

## Reproducible gate and final evidence

```powershell
node tools/operational/pre-uat-source-parity.mjs --snapshot .local/source-complete-uat --phase preflight --output .local/source-parity-audit/preflight-final.json --summary
& tools/operational/Home-UAT.ps1 -Action Start -SourceSnapshot '.local/source-complete-uat'
node --import tsx .local/source-parity-audit/runtime-smoke.mjs
node tools/operational/pre-uat-source-parity.mjs --snapshot .local/source-complete-uat --phase delivery --output .local/source-parity-audit/final-delivery.json --summary
& tools/operational/Home-UAT.ps1 -Action Health -SourceSnapshot '.local/source-complete-uat'
```

First start may be technically healthy (`servicesReady=true`) while `ready=false` and feature checks are pending. A nonzero parity exit, MISSING or BLOCKED forbids READY. Stop uses `-Action Stop` with the same snapshot. Restart repeats preflight and preserves volumes; unchanged source may reuse its exact-SHA validated feature evidence.

**Final exact commit SHA, each actual Runtime SHA, all final statuses, restart/persistence and every remaining item are in `.local/source-parity-audit/FINAL-REPORT.md` and `final-delivery.json`, generated after the final build.** These are ignored evidence artifacts, not application source; generating their observed hashes does not modify the source being attested. `final-delivery.json` contains every compared source filename and SHA, all raw EOL/encoding variants with reasons, complete migration ledger and each feature's checks. Do not substitute this document's earlier build SHA for the actual final Runtime SHA.

Local blockers outside this delivery remain explicit: real P5H Promotion needs a real Go-live decision (Manual review is supported); Owner hands-on UAT, hospital/HIS/physical hardware/clinical acceptance remain pending/unverified. These are not missing implemented Local UAT source. No in-scope source is intentionally excluded; no clinical gate is bypassed.
