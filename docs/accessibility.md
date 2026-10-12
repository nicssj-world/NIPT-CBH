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

## P2 additive ACR checklist — synthetic implementation, 12 October 2026

P1 history above is retained. P2 automated checks use Windows Chromium, the actual synthetic HTTP service under least-privilege `nipt_web`, all WCAG A/AA axe impacts (no severity filter), and no horizontal overflow at 375/768/1280/1440. `tests/e2e/p2.spec.ts` attaches violations and incomplete/needs-review results. An empty violation list does not establish full conformance.

| Screen / URL | Automated browser evidence | Source / keyboard review | Manual / AT status |
|---|---|---|---|
| Overview and registry `/`, `/cases` | Four widths, axe, LN/HN text/zeros, duplicate/conflict, search, role negatives | Visible labels/help, button targets, formatted ten-digit LN; registration Escape and opener restoration | NVDA, 320 CSSpx/400% zoom, text spacing, hospital search/scan trial NOT TESTED |
| Registration dialog | axe including conflict notice, scoped unit/role, paste through text fill, leading zeros | Native dialog; keyboard dismissal; Thai conflict recovery | Physical scanner/hospital device NOT TESTED |
| Five Request categories | axe, age0/GA0, unknown distinct from No, raw BMI, conflict merge, offline retry | Native modal containment, dirty Escape/recovery/opener, field labels/descriptions, required names, live save state; first invalid field focus | NVDA announcements, full focus order on each hospital browser, every conditional combination, 400% zoom NOT TESTED |
| Paper preparation / 13-item review | axe, ANC Pending actor, conditional original ack evidence, decline/amend/replace | Native labelled selects, irrelevant items explicit, actor/capture versus verification distinction | Certifier/operator all-SC review NOT TESTED |
| Consent preparation / mode choice | All four modes, doctor version, representative Paper route, actual handover | No default patient decision; explicit device handover copy | Human handover/clinical acceptance NOT TESTED |
| Isolated `/p2/signing` | axe, twelve actual server acknowledgments, mouse vector, clear/empty rejection, grant/decline, frozen staff | No staff navigation/storage; native labels and radios; drawing alternative is Paper | Touch/pen hardware, NVDA/drag-alternative user trial, Thai comprehension NOT TESTED |
| Original preparer return `/p2/signing` | cancel, separate expired fixture, wrong password/frozen state, completed return, stale-no-final warning | Password manager/paste permitted; required attestation; no staff workspace until successful reauth | NVDA live/error announcement and hospital-device review NOT TESTED |
| Case detail / withdrawal `/cases/[id]` | axe, reason/hold, retained consent, current-round date provenance, PDF permission denial | Semantic history headings, clinical pending text, no color-only state, withdrawal warning | Clinical trial and full all-SC review NOT TESTED |
| PDF dialog | axe outer dialog, actual PDF bytes, identical preview/download, cross-session403, Escape/opener | Labelled same-origin iframe; shared asset for preview/save/print; no draft Request endpoint claim | Browser PDF viewer accessibility, native print flow, PDF tagging/reading order NOT TESTED |
| Doctor registry `/doctors` | axe, real proposal/checker approval, actual HTTP403+durable audit, scoped controls | Version/authorization caption, no fresh signature claim, maker-checker display | NVDA/certifier administration trial NOT TESTED |

Manual source review confirms local Thai font/language, semantic headings/labels, shared contrast tokens, 48px primary controls, no inline-style CSP dependency and no persistent browser PHI store. Automated keyboard checks are not human keyboard acceptance. The all-SC template above still requires explicit criterion-level PASS/FAIL/NOT TESTED, applicability and evidence for every applicable criterion. Incomplete axe findings, iframe/PDF viewer behavior, contrast on native widgets, pointer alternatives, focus visibility/obscuring, target size, consistent help and redundant entry must be resolved by the actual manual reviewer. No exception or formal WCAG conformance is approved by this implementation record.

Batch1 inspected20 UI PNGs (4 foundation registry,16 P2). Registry and isolated signing layouts had no observed clipping. Request category switches retained the previous scroll position, obscuring the heading/close control in6 images. The implementation now resets the native dialog scroll on category change; a targeted no-image browser test verifies heading/close visibility at375/1440 across categories3/5/1/2. The six affected batch1 images were retained as pre-fix evidence until the controller's batch2 refresh; their earlier commit does not prove the final Request layout. Magenta masks normalize only save timestamps and signing expiry.

Incomplete review found unsupported `aria-label` on generic required-star/LN spans. These were replaced with a hidden decorative star plus screen-reader required text and `aria-required` on the control; redundant LN labeling was removed. Targeted registration/Request/PDF retests have zero axe violations; registration and conflict scans have no incomplete findings. Remaining contrast incomplete entries concern dialog content clipped or obscured outside the scroll viewport and require manual criterion-level review; they are not marked PASS. PDF raster inspection by the controller found readable Thai/long text without horizontal clipping, but the unsigned Consent has a second page containing only hash/footer and later pages lack repeated identity/watermark. PDF pagination/readability improvements remain a separately recorded review observation.

Controller batch2 subsequently passed24 browser tests and refreshed/inspected only the six expected Request images (`5aed86f`); title and close are visible. Total visual batches:2, no further captures. Formal Owner acceptance remains pending. Scoped review then identified behavioral validation/lifecycle defects: current regression checks now assert concrete Heparin answer, prior-test method/result, Vanishing-twin date/GA and SCA focus, `aria-invalid`, linked inline errors and summary navigation after the category renders. Delayed-response discard and transient signing recovery have separate live-backend fault-injection assertions. Bangkok exposure times are labelled and tested across midnight/reopen/minute edits, including all five fact fields. These automated fixes do not replace the criterion-level/manual/AT work listed above.
