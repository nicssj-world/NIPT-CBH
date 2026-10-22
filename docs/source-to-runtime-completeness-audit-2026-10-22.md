# Source-to-Runtime Completeness Audit — 2026-10-22

**Audit in progress — no READY claim until delivery gate PASS. OWNER-UAT=PENDING.**

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
