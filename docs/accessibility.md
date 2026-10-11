# UX evidence and ACR template — P1

OD-24 retains UQ-1–UQ-11 unchanged. P1 phase gates are UQ-2 plus component UQ-4 and visual baseline harness UQ-9. Implementation/test evidence and formal acceptance are distinct.

| Gate | P1 evidence / status |
| --- | --- |
| UQ-1 | Source-approved operating flows in PRODUCT/ux-foundation; ANC/Lab representative review remains human evidence for clinical screens |
| UQ-2 | DESIGN.md; tokens in globals.css; 16px body,4/8 spacing, visible label/helper/error patterns; lint passes |
| UQ-3 | Playwright 375/768/1280/1440; overview/cases/health/settings no horizontal overflow; synthetic Thai text; mobile baseline visually inspected |
| UQ-4 | axe-core A/AA across these pages + login/details, all impacts included; real injected minor/moderate violations detected; keyboard/skip/login error recovery and browser storage checks; formal all-SC/manual/NVDA record pending |
| UQ-5 | Loading/error/empty/success/validation patterns implemented; browser tests exercise login failure/recovery, restricted empty view, PDF success; complete clinical state coverage belongs to relevant phases |
| UQ-6 | Stable button sizes/skeleton region; hospital task CLS measurement pending, no numeric pass claimed |
| UQ-7 | No clinical modal in P1; settings dirty warning/native confirmation; focus-trap/Escape tests required when governed dialogs arrive |
| UQ-8 | Thai messages identify recovery action; gate reason codes are domain skeleton, not final clinical operator copy |
| UQ-9 | Four committed Windows/Chromium registry snapshots, threshold0.1%; native regression run passed; baseline is implementation evidence awaiting formal visual owner review |
| UQ-10 | No duplicate S1 receiving step, no PHI input form in P1; downstream task budgets remain locked |
| UQ-11 | No ANC/Lab user trial/signature/SUS fabricated; actual 2–3 ANC +2 Lab users and original thresholds remain required |

Linux CI runs browser accessibility/permission/responsive assertions with visual comparison explicitly disabled because recorded baseline is Windows; it does not regenerate/approve images automatically. Native Windows visual regression remains a separate check.

## Component audit

Impeccable static detector on `src`: zero findings. Human/code review: consistent Thai operating system, no external decorative assets; self-hosted font, semantic headings/forms, 48px controls, focus and skip link. No unsupported claim of complete WCAG conformity. Technical audit scores: accessibility3/4 (manual evidence outstanding), performance3/4 (no task benchmark), responsive3/4 (tested sizes), theming3/4 (approved light-only, shared tokens), integrity4/4; total16/20. These are implementation review scores, not OD-24 acceptance.

## Accessibility Conformance Record (complete separately per screen)

Screen/version/URL: ___; tester/date: ___; OS/browser/build: ___; assistive technology/version: ___; source requirement: WCAG2.2 A/AA.

For **each applicable A/AA success criterion**, record SC number, applicability/reason, PASS/FAIL/NOT TESTED, evidence location, issue, fix and retest. Do not infer PASS from axe silence. Include axe incomplete/needs-review items, keyboard/no trap, focus order/visibility/obscuring, pointer/drag alternatives,44×44 project targets, consistent help, redundant entry, paste/password manager,320CSSpx/400% zoom,text spacing, text/non-text contrast, validation/recovery, status messages,Thai language and NVDA with actual hospital browser. An exception requires reason,user impact,alternative,approver,expiry and repair plan. No exception has been approved here.

P1 pages: login,overview,registry,case-round history,health,settings. Automated report local `playwright-report`; committed tests define reproducible steps. Manual/NVDA and formal all-SC conformance currently **NOT TESTED / NOT SIGNED**.
