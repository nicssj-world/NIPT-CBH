# NIPT-CBH Premium UX V2 — Local Implementation Delivery

Status: LOCAL IMPLEMENTATION READY FOR OWNER UAT (synthetic only; Owner UAT not yet accepted).

Application code commit: 606f3c30161388abf1cc051561c38ead26df485a
Design parent: 0dd3b507594c7300cf7aea658440725e27a68b7e; ANC extension: 1e896cf08617630971f09bd6100493eeabcc9946.

## Implemented phases

- Shared: approved Concept B tokens, locally bundled Thai font, Light/Dark, branding, responsive sidebar/native mobile menu, focus, buttons, fields, tables, overlays, statuses, favicon.
- ANC: real scoped database aggregation and drilldown, four KPIs, seven stages plus exceptions, fiscal selector, unit/search/flag/tab filters, pagination, registration and case-detail links. Refresh/error/stale states never fabricate a successful response.
- Request/Consent: five sections retained; explicit single-choice radios and null clearing; large doctor list uses search plus stable authorized native select; paper fields use radios and existing date inputs; 12 acknowledgments, decisions, signatures, reauthentication and dirty-close/conflict rules remain governed by existing services.
- Lab/Results: shared table/filter/action/control styling and gate evidence spacing; existing worklist/batch/pooling/sequencing/workbook/result workflows preserved.
- Admin/remaining: shared navigation, fields, tables, locked states and nested sections across settings/users/doctors/history/audit/backup/health/password. Existing Maker-Checker and scope unchanged. These remaining routes use the shared system; no claim of pixel-identical bespoke mockup reproduction for every state.

## Backend and contracts

GET /api/anc/dashboard accepts fy, unitId, kpi, stage, flag, tab, q, page, pageSize. It scopes using unchanged case.read AND result.read.released and ANC nurse/supervisor roles before querying case facts. It has no 200-case cap. Same predicates drive metrics and list totals; stages form a non-overlapping partition. Fiscal year is Bangkok Oct1 inclusive to nextOct1 exclusive, S1 first received date and unique case identity. Pending spans years; S2/Repeat/Redraw never become extra cases. Current RESULT release must be Active with CertifiedReleased version on current round; notices/old/superseded/voided/conflicting records are not ready. Documents bind current workspace/mode/draft/latest granted consent, not clinical eligibility.

Read snapshot is READ ONLY; authorized queue access is audited in a separate transaction before returning identifiers. Audit failure returns an error without identifiers. No schema/migration, clinical/QC/release/HIS policy or master/template/label contract changed. No ANC Read/Acknowledged or notification state was invented.

## Verification

- Full regression: 2003 passed, 51 skipped on integration run; later changed ANC/audit behavior separately verified by latest 16 tests.
- Integration browser suite (before the final ANC focus/fiscal-context follow-ups): 60 passed, 1 skipped across P2/P3/P4/P4b/P4c/P5/P5H/P6/P7 and doctor loading race. Visual regression was verified against intentionally updated approved-redesign goldens; original failures from old navigation/snapshots were resolved by adapting UI tests, not reducing guards.
- ANC operational browser: 23 checks, eight theme/viewport examples (375/768/1024/1440), zero reported Axe violations and JS errors. Six preview roles authenticated with secure cookies and training banner. Shared foundation checked 24 combinations initially; final shared page captures were refreshed after exact-code build.
- TypeScript, ESLint and source guard passed. Production host and isolated Docker web builds passed. Dedicated audit-failure test fails closed. Permission matrix baseline 788 checks passed.
- Original Approved Master SHA256 remains 0f94efbc240b9a38ff9be77bf0c8d92c09d82fa2fe2427b9d274cc739e5607a6. Protected schemas/security/domain/Lab/Results/PDF/HALOS/label source files were unchanged. Brand copies retain original SHA256.

## Preview

https://127.0.0.1:19518/login

Worktree: D:\Claude workspace\NIPT-CBH-UX-V2-IMPLEMENTATION
Branch: feat/premium-ux-v2-local
Credentials (local ignored, do not commit/share): .local/ux-v2/credentials.txt
Control: pwsh -File tools/ux-v2/runtime.ps1 -Action Status / Start / Stop / RebuildWeb. Keep the named volumes and .local files; do not use down -v. See runtime-local.md.

## Remaining acceptance and limits

- Native Excel Desktop/physical print/full operational QC3-QC5/release/outbound journey were not rerun end-to-end in the preview. Synthetic browser and unit/contract guards are verified; no hospital/vendor/clinical acceptance follows.
- Preview contains 45 generated cases and three task sheets. HIS inbound/outbound remain disabled, production authorization false, share grants empty. A local synthetic helper initially enabled simulator-only settings; it was stopped and audited defaults restored. Original Integrated UAT was not connected or changed.
- Six preview accounts cover main roles; other role policies are checked by tests, not all role/state combinations independently in a physical browser. Full assistive-technology/physical-touch and staff usability acceptance remain open.
- Doctor control is a filterable native select paired with search, not a custom ARIA combobox. Dark mode applies to UI only. Small favicon artwork detail remains limited at16–24px; original artwork was not edited.
- Approved mockups and runtime screenshots have different synthetic content/state. Comparisons demonstrate composition, hierarchy and tokens, not matched clinical outcomes or a pixel-parity certification. Legacy visual masks apply only to deterministic automated snapshots; unmasked actual captures are included for visual review.

No push, merge, remote deployment or Windows installer. Delivery follow-up commit contains reports/evidence/tooling only; code commit above identifies the preview source.
