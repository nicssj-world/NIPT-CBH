# Project-wide UX/UI pass (2026-10-19)

Branch `feat/ux-projectwide-20261019`, worktree `NIPT-CBH-UX-PROJECTWIDE`, based on the integration baseline `bd89199` plus the registry fix `254fe0a` (cherry-picked as `6bab21e`). Local commits only. This is a refinement of the incumbent V2 system, not a redesign, and no clinical workflow, gate, Owner decision, database logic or DCC template changed.

## Skills actually used

| Skill | How it was used |
| --- | --- |
| **Impeccable** | `context.mjs` loaded PRODUCT.md and DESIGN.md and reported `product-schema-legacy`. `init` backed up the legacy PRODUCT.md and DESIGN.md to this folder, ran one interview round (users and devices, WCAG 2.2 AA, dark theme kept) and wrote PRODUCT.md (schema 1) with every Owner decision preserved. The `audit` and `polish` playbooks and the craft floor set the method. `detect.mjs` ran once over the changed files (see Detector). DESIGN.md was updated to the live V2 tokens and the new patterns. |
| **UI UX Pro Max** | The `--design-system` query (hospital lab operations, density 7, variance 2, motion 2) and the `ux` / `nextjs` domain searches. Its style proposal was **not adopted**: Exaggerated Minimalism with Fira fonts from the Google CDN conflicts with the locked light baseline, the bundled Noto Sans Thai and the no-CDN rule. Its accessibility, touch, responsive and forms checklist was the audit rubric. |

## Method: real browser, not source reading

`tools/ux-audit/serve.ts` runs the production standalone build against a reserved clone (`nipt_synthetic_p2_browser_ux`) of a full e2e-run database:
- 142 cases;
- 16 Runs, with Task Lists, pooling and sequencing;
- 6 photos;
- 5 result versions;
- historical imports.

`tools/ux-audit/audit.ts` drives Chromium as every role (lab, anc, admin, approver, certifier, auditor). It is read-only: it follows page links and never clicks actions. It discovers every reachable route from the router, then measures each route at **1440 / 1280 / 768 / 390 / 375 px**:
- horizontal overflow and the elements causing it;
- overlapping controls;
- touch targets under 44 px and under 24 px;
- BE date field geometry;
- axe WCAG 2.2 AA violations;
- console and page errors;
- a full-page screenshot.

Extra coverage beyond the crawl: `/` for ANC and Admin, `/cases` for ANC, the anonymous `/login` page, and a dark-theme pass.

Routes covered (25 plus 4 role variants):
- **Overview and registry:** `/`, `/cases`, `/cases/:id`
- **Reception:** `/inbound`
- **Lab:** `/lab`, `/lab/batches`, `/lab/batches/:id`, `/lab/batches/:id/pooling`, `/lab/batches/:id/sequencing`, `/lab/batches/:id/workbook`, `/lab/photos`, `/lab/photos/:id`
- **Results:** `/results`, `/results/:id`
- **Historical:** `/historical`, `/historical/:id`
- **Doctors and health:** `/doctors`, `/health`
- **Settings:** `/settings`, `/settings/users`, `/settings/units`, `/settings/audit`, `/settings/backup`, `/settings/run-photos`
- **Account:** `/password`, `/login`

`/p2/signing` is covered by the e2e signing journeys.

| Round | Measurements | With mechanical issues |
| --- | --- | --- |
| Baseline | 125 | 21 |
| Round 1 | 145 | 5 (one route; detector false positive fixed) |
| Final, light | 145 | **0** |
| Final, dark (1440 / 768 / 375) | 87 | **0** |

Screenshots and JSON: `.local/ux-audit/<round>/` (local evidence, ignored by git).

## Defects found and fixed

| Severity | Screen / module | Finding | Fix |
| --- | --- | --- | --- |
| P0 | Dashboard and Registry, all roles | `/api/p2/cases` returned 400 on a populated database: one stored draft without `history` made `requestIssues()` throw, so the registry showed an error and the empty state together | `requestProgressIssues()`, display only (integration fix `254fe0a`, unit test) |
| P1 | **Shared BE date control**, every page using `ThaiDateInput` / `ThaiDateTimeInput` (Task List plan, P2 request DOB, photos and others) | Under 600 px the global `.button{width:100%}` stretched "ปฏิทิน" to the full row and squeezed the date to about 26 px; it also overflowed at 375 | `.be-date-row .be-date-open{width:auto}` and an input min-width, fixed once in shared CSS; the photo-only workaround was removed |
| P1 | Case page (ANC) | The result panel showed a CE ISO date ("เก็บตัวอย่าง 2026-08-04"), against the Owner BE rule | `formatBe` in `anc-results.tsx` |
| P1 | Batch, Worklist, P5H, Run-photo storage (12 tables) | `.table-wrap` scroll regions were not keyboard-focusable (axe `scrollable-region-focusable`, serious) | `role="region"`, a Thai `aria-label` and `tabIndex={0}` on all 25 wraps |
| P1 | Case page Consent actions | "ใช้ Paper Consent" and the destructive "ผู้ป่วยไม่ยินยอม (Paper)" were stacked with a 0 px gap | Wrapped in `.action-bar` (markup only) |
| P1 | P5 review / P2 preview / workbook preview | Regression from `91ae52c`: a global `.pdf-frame{height:28rem;border:var(--border)}` (undefined token) shrank the sticky P5 PDF viewer and the P2 preview | Scoped to the case-page iframes as `.case-pdf-frame` |
| P2 | Excel workbook editor | Buttons touching, the label crammed against the controls, alert text unstyled, the history heading cramped | `.action-bar`, a sheet list with dividers and chevrons, warning notices, spacing |
| P2 | P5 result review | The "ฉบับแก้ไข" checkbox label wrapped under its box (`.stack>label{display:grid}` overrode `.check-label`) | `label.check-label` holds its flex layout everywhere |
| P2 | Registry search | Buttons were aligned to the helper text, not the input | Single-field search rows offset by the label; multi-field filters keep bottom alignment |
| P2 | ANC dashboard search | The button sat 8 px below the input (the global label margin plus `align-items:end`) | `.anc-filters label{margin-bottom:0}` |
| P2 | Registry error | Error and empty state shown together; the retry button touched the next heading | Empty state only without an error; retry spacing |
| P2 | Settings | The selected category reused the keyboard-focus outline; sub-categories (both "7.") were listed after 10; the admin sub-navigation was bare links with no current page | Selected state on `--info-bg`; stable sort by Plan category; `AdminNavLink` with `aria-current`, 44 px links |
| P2 | Overview (non-ANC roles) | No operational entry points (the brief asked for quick actions) | `QuickActions`: links to destinations the sidebar already grants (same `authorize` checks), with no counts and no new step |

## Detector

`detect.mjs` over the changed files found one warning: `transition: width` on the Run-photo upload progress bar (`::-webkit-progress-value`, from the photo branch). This is a narrow intentional exception. The native progress pseudo-element cannot use transform, the bar is 6 px tall, and it animates only during an upload.

## Visual baselines

The full Playwright run failed only on 4 visual tests. Every diff was inspected (old and new pixels and side-by-side crops) before the baselines were regenerated through the isolated runner:
- **Registry 768 / 1280 / 1440:** the buttons line up with the input.
- **P2 batch (11 frames):** the page behind the dialog shifted because the Consent buttons moved into `.action-bar`; `p2-request-375` shows the fixed BE date control, and the old baseline had captured the bug; the signing frames show the unified `check-label` spacing.

No other change was accepted.

## Verification

All results are from this branch, on synthetic data.

| Gate | Result |
| --- | --- |
| Source guard | PASS, 881 files |
| Typecheck / lint (`--max-warnings 0`) | PASS / PASS |
| Deploy contracts | 13 / 13 |
| Vitest, one run with native PostgreSQL 17, every fixture and native Excel | **2215 / 2215 passed, 0 failed, 0 skipped** |
| Build (`next build`, standalone) | PASS |
| Playwright, every spec except `p8-installed` (needs an installed Windows candidate) | **93 / 93 passed, 0 skipped**, in one run after the baselines were reviewed |
| Operational journey `--anc --recovery` | PASS (production build, backup/restore, migration reapply). Physical Halos, hospital LAN and HIS: NOT_RUN by design |
| UX audit, final | 0 issues in 145 light and 87 dark measurements |

Consent (marker, refusal, digital signing, withdrawal), Run Photo Evidence (8 e2e tests), Task List 1–3, PET reception and the P5 manual scan and upload all pass unchanged in these suites.

## Not changed (by rule)

None of the following changed:
- PET reception, FIFO / Task List rules, QC gates or Consent decisions;
- Paper marker-only behaviour or Paper refusal blocking;
- Result/HIS gates or the manual-triggered P5 scan;
- database business logic or DCC templates.

No approvals, confirmations, mandatory uploads or clicks were added. Screens that already measured clean and looked right were left alone: inbound, lab worklist, pooling, sequencing, photos, results queue, historical, doctors, health, users, units, audit, backup and password.

## Limitations

- Real devices (tablets and phones on the hospital LAN) and real screen readers were not tested. Chromium device emulation and axe are not user acceptance.
- Run-photo bytes in the cloned DB were removed by the e2e runner's per-run reset, so the gallery was audited in its "file missing" state. Upload, viewing and the populated gallery are covered by the e2e `run-photos.spec.ts`.
- The login throttle is DB-backed per client address, so the audit tool clears `login_throttle` in its own disposable clone before each run.
