# NIPT-CBH — UI Status / Detail Remediation Checklist

**Scope:** System-wide Status, Detail, Monitoring, Information Panels, ANC/Admin/LAB Navigation, and owner-approved APP_ADMIN system-wide RBAC change
**UI worktree:** `D:\Claude workspace\NIPT-CBH-PARITY-REMEDIATION\.local\ui-status-detail-remediation`
**Branch:** `feat/ui-status-detail-remediation-20261024`
**Base HEAD:** `1a4055ac8136f10684e8a818e458b4341b22a439`
**Owner Visual UX decision:** REJECTED — previous technical PASS counts are not Visual UX acceptance.
**Current result:** Visual corrective implementation and internal review completed; OWNER VISUAL ACCEPTANCE PENDING. See the corrective section below. Previous 125 PASS counts do not establish Visual UX acceptance.
**UAT runtime:** `http://127.0.0.1:19928` — local, loopback-only, synthetic data

## Status rules

- `PASS` means the source or Browser behavior named in the item was checked and its evidence is listed.
- `FAIL` means a defect is confirmed and remains unfixed. No in-scope UI defect remains in the routes marked PASS.
- `BLOCKED` means a specific owner/task/data/role boundary prevents safe completion. It is not counted as PASS.
- `N/A` is reserved for a proven non-applicable requirement. No item below uses N/A.
- Every source page route is listed in the Page Inventory. The inventory row status is separate from the 127 numbered acceptance criteria counted below.
- Screenshots and reports are local evidence, not owner acceptance. The app uses synthetic fixtures only.

## Historical technical counts — not current Visual UX acceptance

| Measure | Result |
|---|---:|
| Source page routes inventoried | 29 / 29 |
| Prior-scope Browser route pages exercised | 29 / 29 |
| Page Inventory PASS | 25 |
| Page Inventory BLOCKED / deferred | 4 |
| Pages requiring a safe UI fix | 7 |
| Pages fixed and rechecked | 7 |
| Pages kept unchanged after review | 18 |
| Acceptance criteria | 127 |
| Checklist PASS | 125 |
| Checklist FAIL | 0 |
| Checklist BLOCKED | 2 |
| Checklist N/A | 0 |

The 105-item UI baseline has two remaining BLOCKED criteria: A05 (Owner-locked workbook Master SHA) and A12 (state-changing workflow dialogs). All other baseline criteria pass. All 22 APP_ADMIN Owner-lock criteria pass from current tests and authenticated Browser evidence; the three Admin navigation criteria N04–N06 were rechecked on the final runtime and pass. No Admin result is carried forward from the old `/lab` denial behavior.

The 29 source routes reconcile to the Browser evidence: 21 broad route patterns (EV02/EV03), six Settings pages (EV05/EV06), `/login` through authenticated sign-ins (EV04/EV05), and `/p2/signing` (EV09). The 27-page broad-plus-Settings coverage therefore has two additional routes with separate Browser evidence; none is omitted.

The four route blockers are `/lab/batches/[id]/bench`, `/lab/batches/[id]/workbook`, `/sample-storage`, and `/p2/signing`. A05 and A12 remain blocked; they are not hidden by the current PASS count.

## Evidence index

All paths are relative to the UI worktree. `.local/ux-audit/` is ignored by Git but exists on this machine.

| Ref | Actual evidence |
|---|---|
| EV01 | Before comparison: `.local/ux-audit/baseline-light/shots/cases-anc-375.jpg` — `/cases`, ANC synthetic role, 375px. |
| EV02 | Current broad light audit: `.local/ux-audit/final-candidate-light/report.json` and `shots/` — 21 route patterns, 75 measurements, no Axe violations or horizontal overflow; six HTTP 409 responses limited to Bench/Workbook API calls. |
| EV03 | Current broad dark LAB audit: `.local/ux-audit/final-candidate-dark-lab/report.json` and `shots/` — 21 route patterns × 3 widths (63 measurements), Axe 0, overflow 0, overlap 0; same six Master-gate 409 responses. |
| EV04 | Prior authenticated ANC/Admin/LAB/other-role Browser regression: `.local/ux-audit/final-navigation/report.json` — 86 PASS / 0 FAIL. ANC/LAB evidence remains historical; Admin navigation and denied `/lab` observations are superseded by the 2026-10-24 Owner lock and cannot support current Admin PASS claims. |
| EV05 | Prior Admin light/dark Browser regression: `.local/ux-audit/final-navigation/admin-role-dark.json` — 42 measurements on the old Admin navigation, across `/doctors` and Settings at 1440/768/375px. Its previous Admin sidebar/ANC-topbar and logout measurements are historical; current Admin shell must be rechecked. |
| EV06 | Admin Settings light audit: `.local/ux-audit/final-navigation/admin-settings.json` — six routes × three widths, 18/18 HTTP 200, Axe 0, overflow 0. |
| EV07 | Final current-source touch target regression: `.local/ux-audit/final-checkbox-fix/report.json` and `screens/` — `/lab`, `/results`, `/historical/[id]` × 3 widths × 2 themes, 18 PASS / 0 FAIL, target wrappers ≥44×44px, overflow 0, Axe 0; local selection toggled/restored where enabled. |
| EV08 | Actual loading/empty/error Browser states: `.local/ux-audit/final-states/report.json` and `screens/` — delayed real GET shows `กำลังโหลดข้อมูล…`; unmatched LAB search shows `ไม่มีรายการในคิวนี้ ที่ตรงกับคำค้น`; Bench exposes the Master SHA error in a visible alert. |
| EV09 | Owner-locked signing route: `.local/ux-audit/final-navigation/p2-signing/report.json` — `/p2/signing` × 1440/768/375 × light/dark, 6 HTTP 200, Axe 0, overflow 0. No valid patient token or signing action was used. Screenshot: `.local/ux-audit/final-navigation/p2-signing/screens/p2-signing-375-dark.png`. |
| EV10 | Same route/role/width before-after screenshots: EV01 above and `.local/ux-audit/final-candidate-light/shots/cases-anc-375.jpg`. The latter is post-change and shows the ANC-only shell. Additional post-change navigation captures are in `.local/ux-audit/final-navigation/screens/`. |
| EV11 | Prior UI source patch: `.local/ux-audit/final-validation/source.patch`; SHA-256 `83dbb8d0f9ac6adea471fefe4a6a6fb8d7d1579669466976feb1af20ae7fe247` (tracked UI source diff before the Owner RBAC addendum; checklist excluded). |
| EV12 | Synthetic role matrix: `.local/ux-audit/final-navigation/role-matrix.json` — seven actual synthetic users; `synthetic.admin` is APP_ADMIN only, `synthetic.lab` is LAB_STAFF only, and no Admin+LAB test identity exists. |
| EV13 | Source/runtime parity: `.local/ux-audit/final-validation/source-runtime-parity.json` — current `.next/BUILD_ID` `Q3FZyAvHvrEz29yDfoSyJ` is present in the loopback `/login` HTML; all nine served static assets are HTTP 200 and byte-identical to the matching `.next/static` files; `/api/health` is HTTP 200 in synthetic mode. |
| EV14 | Final Owner-lock authenticated Browser regression: `.local/ux-audit/admin-system-wide/final-browser/report.json` and `screens/` — 6/6 checks PASS. APP_ADMIN signed in with only `APP_ADMIN`, traversed ANC → LAB → Settings, opened all 12 global menu routes and five Settings subroutes (17 route visits), and opened/refreshed `/lab` directly (200). 22 authenticated authorized API calls were exercised: 20 returned 200 and Bench/Workbook returned 409 `TASK_MASTER_PATH_REQUIRED` at the Owner/master data gate, not 401/403. ANC and LAB_STAFF negative/API checks preserved. Admin and ANC responsive/theme matrices have zero horizontal overflow and Axe violations; mobile keyboard navigation, logout, `/api/me` 401 and DB `app_session.revoked_at` were verified. Current build ID `kMVGlWDs_JYup6J2Wm7g8`; 13 static assets are byte-identical and synthetic `/api/health` is 200. |
| EV15 | Incremental Owner-lock source diff: `.local/ux-audit/admin-system-wide/owner-lock-source.patch`; contains the delta from the pre-lock UI snapshot for overlapping files and the APP_ADMIN ACL/API/test changes, excluding the earlier UI-only remediation. Patch/checklist SHA-256 and the 24-file manifest are in `.local/ux-audit/admin-system-wide/owner-lock-source-manifest.json`. |
| EV16 | Multi-runtime synthetic Admin seed and authenticated Browser evidence: `.local/uat-admin-standardization/seed-report.json` and `.local/uat-admin-standardization/browser-evidence/admin-login-regression.json`; five loopback-only Synthetic runtimes seeded, actual `admin` login/APP_ADMIN role/ANC/Settings/Logout tested on all five, LAB passed on four and returned 404 on the older Synthetic Release runtime. Five Settings screenshots are in `.local/uat-admin-standardization/browser-evidence/`. The seed password file is Git-ignored and is not linked or included in this checklist. |

## Implementation summary

- ANC-only users retain the route-derived top navigation with logo left, authorized menu centered, and username/theme/existing Logout on the right. The ANC-only workspace has no desktop sidebar or mobile sidebar drawer.
- APP_ADMIN and LAB users use one global navigation set. APP_ADMIN navigation is derived from the system-wide permission allowlist and does not show an extra ANC menu; LAB_STAFF continues to receive the existing LAB navigation.
- The existing logout component/API/session workflow is reused. The Owner-approved APP_ADMIN ACL and direct server guards were updated; authentication/session implementation, API contracts, database schema, certification/sign-off identities, and clinical output logic were not changed.
- The 20×20 native table checkboxes keep their appearance and behavior; their label hit areas now measure 44×44px. Historical review/filter labels have a 44px minimum hit area. ANC disabled KPI contrast no longer relies on opacity. Historical revision controls keep a 44px target and keyboard focus visibility.
- Changed source files include the prior UI set plus `packages/security/policy.ts`, ANC/dashboard, result export/reparse, Run Photo, historical manual review, Admin-aware case/result guards, and the affected regression tests. The incremental Owner-lock diff is recorded separately under `.local/ux-audit/admin-system-wide/`.

## Page Inventory — all 29 source routes

Routes and rendered components are derived from the 29 `src/app/**/page.tsx` files and their imports at base HEAD. `Browser evidence` refers to EV01–EV10 and the current-build Owner-lock run EV14; blocked routes still have a real route visit and are marked BLOCKED when full acceptance cannot be done safely.

| Route | Actual page file → rendered component(s) | Existing problem / finding | Action | Status | Evidence / notes |
|---|---|---|---|---|---|
| `/` | `src/app/(protected)/page.tsx` → Registry, AncDashboard, QuickActions (role-dependent) | ANC-only route shared the global shell | FIX | PASS | EV04, EV10, EV14; ANC top nav and Admin global route are authenticated; Admin navigated to ANC and LAB workspaces in one session. |
| `/cases` | `src/app/(protected)/cases/page.tsx` → Registry | ANC-only route shared the global shell | FIX | PASS | EV04, EV10, EV14; ANC active `/cases`, mobile 375px and route search/empty state verified; APP_ADMIN route opens from global navigation. |
| `/cases/[id]` | `src/app/(protected)/cases/[id]/page.tsx` → CaseWorkspace, AncResults, CasePdfIntake | ANC-only detail route shared the global shell | FIX | PASS | EV04; direct detail route, active `/cases`, refresh, all three widths and themes. |
| `/doctors` | `src/app/(protected)/doctors/page.tsx` → DoctorRegistry | ANC and Admin ANC content navigation needed role-aware placement | FIX | PASS | EV04, EV05, EV14; ANC has top nav; APP_ADMIN uses only the global menu, with no duplicate ANC menu. |
| `/health` | `src/app/(protected)/health/page.tsx` → systemHealth, LocalAlertTest | No verified layout defect | KEEP | PASS | EV02, EV03, EV14; 1440/768/375 responsive route sweep and Admin global route access. |
| `/historical` | `src/app/(protected)/historical/page.tsx` → HistoricalHome | No verified detail-layout defect | KEEP | PASS | EV02, EV03, EV14; route audit at all three widths and Admin authenticated route/API access. |
| `/historical/[id]` | `src/app/(protected)/historical/[id]/page.tsx` → HistoricalBatch, HistoricalRevisions | Revision action and review checkbox hit areas needed mobile sizing | FIX | PASS | EV03, EV07; 44px target/focus style and 18 current-source measurements. |
| `/inbound` | `src/app/(protected)/inbound/page.tsx` → PET/RES/OK monitor, TestConnectionButton, DeepScanForm, IssueActions, Pager | No verified layout defect | KEEP | PASS | EV02, EV03, EV14; status and monitoring route sweep; Admin `/api/health`/HIS navigation scope exercised without mutation. |
| `/lab` | `src/app/(protected)/lab/page.tsx` → LabWorklist | Table row selection controls were 20×20px hit areas | FIX | PASS | EV03, EV07, EV14; 44×44px label targets, Admin direct deep link, active route and 200 worklist API. |
| `/lab/batches` | `src/app/(protected)/lab/batches/page.tsx` → CreateBatchButton, Pager | No verified layout defect | KEEP | PASS | EV02, EV03, EV14; APP_ADMIN global menu and `/api/p4/batches` both return 200. |
| `/lab/batches/[id]` | `src/app/(protected)/lab/batches/[id]/page.tsx` → BatchWorkspace | No verified layout defect | KEEP | PASS | EV02, EV03; route inventory remains complete; no batch mutation submitted. |
| `/lab/batches/[id]/bench` | `src/app/(protected)/lab/batches/[id]/bench/page.tsx` → LabBench | Owner/master gate blocks Bench data | DEFER | BLOCKED | EV02, EV03, EV08, EV14. Prior broad Browser evidence records expected SHA `4c5300f9039af57c0d0649160f5da8e4c2ee1ed7ae44dd7aa525823104f9c7f1` vs available `0f94efbc240b9a38ff9be77bf0c8d92c09d82fa2fe2427b9d274cc739e5607a`; current authenticated API returns 409 `TASK_MASTER_PATH_REQUIRED` because the loopback runtime has no task-master path configured. No hash/path bypass or file replacement. |
| `/lab/batches/[id]/pooling` | `src/app/(protected)/lab/batches/[id]/pooling/page.tsx` → PoolingWorkspace | No verified layout defect | KEEP | PASS | EV02, EV03; no pooling action submitted. |
| `/lab/batches/[id]/sequencing` | `src/app/(protected)/lab/batches/[id]/sequencing/page.tsx` → SequencingWorkspace | No verified layout defect | KEEP | PASS | EV02, EV03; no sequencing action submitted. |
| `/lab/batches/[id]/workbook` | `src/app/(protected)/lab/batches/[id]/workbook/page.tsx` → WorkbookEditor | Owner/master gate blocks Workbook data | DEFER | BLOCKED | EV02, EV03, EV14; same prior expected/available SHA as Bench; current authenticated API returns 409 `TASK_MASTER_PATH_REQUIRED`. No bypass or workbook source/output change. |
| `/lab/photos` | `src/app/(protected)/lab/photos/page.tsx` → RunPhotoSearch | No verified layout defect | KEEP | PASS | EV02, EV03, EV14; Admin read-only `/api/run-photos/search` returned 200. |
| `/lab/photos/[batchId]` | `src/app/(protected)/lab/photos/[batchId]/page.tsx` → RunPhotoGallery, FileDropInput | Native file inputs are narrow, but visible associated capture/picker labels are the touch targets | KEEP | PASS | EV02, EV03; source `htmlFor` pairing and 48px visible button labels verified. No photo upload submitted. |
| `/login` | `src/app/login/page.tsx` → LoginForm, ThemeButton | Login route is used for all real synthetic role sessions | KEEP | PASS | EV02, EV04, EV05, EV14; ANC, APP_ADMIN and LAB_STAFF authenticated Browser sign-ins succeeded; build assets served byte-identically. |
| `/p2/signing` | `src/app/p2/signing/page.tsx` → PatientSigning | Valid patient token is unavailable and patient consent/signing is Owner-locked | DEFER | BLOCKED | EV09; only no-token synthetic screen visited; no patient token or signing action used. |
| `/password` | `src/app/password/page.tsx` → PasswordEditor | No verified layout defect | KEEP | PASS | EV02, EV03. No password change submitted. |
| `/results` | `src/app/(protected)/results/page.tsx` → ResultWorkspace | Table file-selection controls were 20×20px hit areas | FIX | PASS | EV02, EV03, EV07, EV14; no import/confirm action submitted; Admin `/api/p5/results` returned 200. |
| `/results/[id]` | `src/app/(protected)/results/[id]/page.tsx` → ResultReview | Existing `.check-label` target is already ≥44px | KEEP | PASS | EV02, EV03; no clinical review/certification action submitted. |
| `/sample-storage` | `src/app/(protected)/sample-storage/page.tsx` → SampleStorage | Active Task 2 edits the same storage surface | DEFER | BLOCKED | EV02, EV14; APP_ADMIN menu route and read API return 200, but no UI source change was made. Conflicting Task 2 files: `src/components/sample-storage.tsx` and `src/components/sample-storage.module.css` in the separate active Task 2 context. |
| `/settings` | `src/app/(protected)/settings/page.tsx` → SettingsEditor, HisSettingsStatus | No verified layout defect; Admin Settings access retained | KEEP | PASS | EV05, EV06, EV14; direct/deep access and responsive global navigation; no setting changed. |
| `/settings/audit` | `src/app/(protected)/settings/audit/page.tsx` → AuditViewer | No verified layout defect | KEEP | PASS | EV05, EV06, EV14; APP_ADMIN direct route returns 200. |
| `/settings/backup` | `src/app/(protected)/settings/backup/page.tsx` → systemHealth summary | No verified layout defect | KEEP | PASS | EV05, EV06, EV14; APP_ADMIN direct route returns 200. |
| `/settings/run-photos` | `src/app/(protected)/settings/run-photos/page.tsx` → StorageSettings | No verified layout defect | KEEP | PASS | EV05, EV06, EV14; direct route returns 200. No storage setting changed. |
| `/settings/units` | `src/app/(protected)/settings/units/page.tsx` → AdminConsole units | No verified layout defect | KEEP | PASS | EV05, EV06, EV14; direct route returns 200. No unit changed. |
| `/settings/users` | `src/app/(protected)/settings/users/page.tsx` → AdminConsole users | No verified layout defect | KEEP | PASS | EV05, EV06, EV14; direct route returns 200. No user/role changed. |

## A. UI Inventory — acceptance criteria

| ID | Acceptance item | Status | Evidence / notes |
|---|---|---|---|
| A01 | Inspect HIS/LIS connection status | PASS | EV02, EV05, EV06; inbound and Settings route panels exercised. |
| A02 | Inspect PET/RES/OK monitoring | PASS | EV02, EV03; `/inbound` status page in light/dark responsive audit. |
| A03 | Inspect Sample Registry and Sample Detail | PASS | EV04; `/cases` and actual `/cases/[id]` exercised as authenticated ANC. |
| A04 | Inspect Task List 1–3 and detail panels | PASS | EV02, EV03, EV07; route-level responsive audit and LAB worklist touch-target regression. Sample Storage is separately deferred in its route row. |
| A05 | Inspect QC measurements | BLOCKED | Bench/Workbook remain gated: prior Browser check found the Owner-locked SHA mismatch; current authenticated API reaches a 409 `TASK_MASTER_PATH_REQUIRED` gate. Evidence EV02, EV03, EV08, EV14. |
| A06 | Inspect Pooling and Pooling Detail | PASS | EV02, EV03; route and responsive layout inspected without submitting an action. |
| A07 | Inspect Sequencing and Sequencing Detail | PASS | EV02, EV03; route and responsive layout inspected without submitting an action. |
| A08 | Inspect Import/Export Status | PASS | EV02, EV03, EV07; Results and Historical page patterns exercised; no import/export action submitted. |
| A09 | Inspect Processing/Worker Status | PASS | EV02, EV03; inbound and system monitoring route screenshots and measurements. |
| A10 | Inspect System Health/Diagnostics | PASS | EV02, EV03, EV05; `/health` and `/settings/backup` responsive routes. |
| A11 | Inspect Settings and Connection Configuration | PASS | EV05, EV06; six Admin Settings routes measured at 1440/768/375 in light/dark. |
| A12 | Inspect every relevant Dialog, Drawer, and Modal | BLOCKED | Source inventory is complete and navigation drawers were exercised, but every workflow dialog was not opened because that can submit/change QC, clinical, import, or other workflow state. No workflow mutation was used to manufacture evidence. |
| A13 | Inspect shared Label–Value components | PASS | EV02, EV03; shared definitions/details exercised across all 21 broad-audit routes in light/dark; no horizontal spill or overlap. |
| A14 | Inspect other source routes with the same layout risk | PASS | `rg --files src/app -g page.tsx` returns 29; all 29 are represented in the Page Inventory and route evidence EV02–EV09. |

## B. Information Hierarchy

| ID | Acceptance item | Status | Evidence / notes |
|---|---|---|---|
| B01 | Most important status is visible immediately | PASS | EV02, EV03, EV08; actual LAB summary and loading/error text visible in Browser. |
| B02 | Label and value relationship is clear | PASS | EV02, EV03; rendered status/detail panels and shared definition lists checked. |
| B03 | Labels and values are not unnecessarily separated across wide containers | PASS | EV02, EV03; screenshots across desktop/tablet/mobile and source shared patterns. |
| B04 | Related information is grouped by context | PASS | EV02, EV03; status/detail route sweep found no grouping/layout defect. |
| B05 | Important information is more prominent than supporting information | PASS | EV02, EV03, EV10; current ANC and LAB views preserve heading/status hierarchy. |
| B06 | Headings and messages are not redundant | PASS | EV02, EV03; route screenshots and visible loading/empty/error copy EV08. |
| B07 | Cards, badges, and dividers are not excessive | PASS | EV02, EV03; no added card layer; unchanged views were kept. |
| B08 | Main information reads top-to-bottom without needless horizontal scanning | PASS | EV02, EV03; no route overflow/overlap; 375px views remain within viewport. |

## C. Layout / Spacing / Typography

| ID | Acceptance item | Status | Evidence / notes |
|---|---|---|---|
| C01 | Grouped key–value or another suitable layout is used | PASS | EV02, EV03; visible detail and Settings panels checked. |
| C02 | Label–value spacing is suitable | PASS | EV02, EV03; shared patterns and screenshots. |
| C03 | Spacing between groups is consistent | PASS | EV02, EV03; route-wide screenshots at 1440/768/375. |
| C04 | No large unused space remains without purpose | PASS | EV02, EV03; no verified spacing defect in pass routes. |
| C05 | Two columns are not forced where content does not fit | PASS | EV02, EV03; responsive layouts checked at 768/375. |
| C06 | Typography hierarchy is readable | PASS | EV02–EV05, EV10; Thai copy and hierarchy inspected in both themes. |
| C07 | Long values do not collide, overlap, or truncate incorrectly | PASS | EV02, EV03, EV05; overflow and overlap were zero in measured layouts. |
| C08 | Information density is preserved without needless page height | PASS | EV02, EV03; fixes were scoped to nav shell and touch hit areas. |

## D. Responsive / Thai Localization

| ID | Acceptance item | Status | Evidence / notes |
|---|---|---|---|
| D01 | Desktop 1440px | PASS | EV02–EV07; full route and role matrices include 1440px. |
| D02 | Tablet 768px | PASS | EV02–EV07; ANC/Admin/LAB navigation and route layouts measured at 768px. |
| D03 | Mobile 375px | PASS | EV02–EV10; mobile route screenshots, drawers, hit areas, and ANC shell. |
| D04 | No horizontal overflow | PASS | EV02–EV09; all audited measurements reported 0 overflow. |
| D05 | Thai text wraps naturally | PASS | EV02–EV08; actual Thai pages/screens checked at 375/768px. |
| D06 | Patient/staff names and dates do not wrap unnaturally | PASS | EV02, EV03, EV05; synthetic names/dates observed; no overflow or overlap. |
| D07 | Long paths and technical values display suitably | PASS | EV02, EV03, EV05; detail/settings views checked at three widths. |
| D08 | Light mode | PASS | EV02, EV04–EV07; final role, route, settings, and hit-area checks include light mode. |
| D09 | Dark mode | PASS | EV03, EV05, EV07, EV09; dark route and role matrices have Axe 0 and overflow 0. |
| D10 | Mobile buttons and interactive controls remain usable | PASS | EV04, EV07; ANC nav minimum target 44px; table labels and history checks ≥44px; file picker labels ≥48px. |

## E. Status / Interaction / Accessibility

| ID | Acceptance item | Status | Evidence / notes |
|---|---|---|---|
| E01 | Normal and abnormal status are clearly distinguished | PASS | EV02, EV03, EV08; status copy and error alert are visible in Browser. |
| E02 | Color is not the only status signal | PASS | EV02–EV05, EV08; statuses include text; Axe found no violations in measured surfaces. |
| E03 | Loading state is understandable | PASS | EV08; delayed actual GET displayed `กำลังโหลดข้อมูล…` as `role=status`. |
| E04 | Empty state is clear | PASS | EV08; unmatched read-only LAB search displayed `ไม่มีรายการในคิวนี้ ที่ตรงกับคำค้น`. |
| E05 | Error state explains the issue and relevant action | PASS | EV08; real 409 surfaced an alert naming the Owner-locked Master SHA and asking for the correct source. |
| E06 | Keyboard navigation remains usable | PASS | EV04, EV05; ANC keyboard check reached skip link; mobile drawers and links activated by Browser; logout stays operable. |
| E07 | Focus behavior remains intact | PASS | EV04; keyboard focus was visible with a solid outline. |
| E08 | Labels and accessible names are correct | PASS | EV02–EV09; Axe 0 for final audited route matrices; role-specific links/actions have accessible names. |

## F. Regression Safety

| ID | Acceptance item | Status | Evidence / notes |
|---|---|---|---|
| F01 | No database schema or migration changes | PASS | EV11; changed-source list contains no migration/database file. |
| F02 | No API contract changes | PASS | EV11; no `src/app/api` or contract file changed. |
| F03 | No business logic changes | PASS | EV11; edits are role-aware presentation and CSS/touch-target wrappers only. |
| F04 | No permission/RBAC changes | PASS | EV04, EV11, EV12; current permission props are reused; no role or access rule changed. |
| F05 | No authentication changes | PASS | EV04, EV05, EV11; existing LogoutButton/API/session workflow reused; no auth logic changed. |
| F06 | No QC/Pooling/Sequencing calculation changes | PASS | EV11; no calculation or service file changed. |
| F07 | No HIS PET/RES/OK processing changes | PASS | EV11; no worker/protocol/API file changed. |
| F08 | No PDF/XLSX output changes | PASS | EV11; no renderer, template, export, or workbook output file changed. |
| F09 | Task 1 Candidate remains untouched | PASS | Separate worktree remains at `cf70065d8eed6f3096f870ebd683035db666d98d`, with clean status. |
| F10 | Task 2 remains untouched | PASS | UI diff has no Task 2 Sample Storage source; Task 2 route is deferred rather than edited. Main checkout was not changed by this work. |
| F11 | Task 1.5 was not started or changed | PASS | EV11; no registration route/component or Task 1.5 worktree changed. |
| F12 | No unnecessary dependency was added | PASS | EV11; `package.json` and lockfile are unchanged. |

## G. Technical Validation

| ID | Acceptance item | Status | Evidence / notes |
|---|---|---|---|
| G01 | Typecheck | PASS | `npm.cmd run typecheck` completed successfully after build, with `next typegen` and `tsc --noEmit`. |
| G02 | ESLint | PASS | `npm.cmd run lint` completed successfully (`eslint . --max-warnings 0`). |
| G03 | Production build | PASS | `npm.cmd run build` completed successfully on Next.js 16.4.0. It emitted five existing dynamic-filesystem tracing warnings in unrelated API/workbook code. |
| G04 | Affected component tests | PASS | EV04/EV05/EV07; current-source Browser interaction checks passed: 86 role checks, 42 Admin measurements, 18 control measurements. No source test/dependency was added. |
| G05 | Authenticated Browser regression | PASS | EV04/EV05; ANC/Admin/LAB/other-role sessions, direct routes, menu state, responsive layout, logout, and server-side session revocation checked. |
| G06 | Responsive verification | PASS | EV02–EV07; 1440/768/375 widths; no overflow on audited views. |
| G07 | Light/dark verification | PASS | EV02–EV09; both themes included in ANC, Admin, broad LAB, hit-area, and signing audits. |
| G08 | Keyboard/accessibility verification | PASS | EV04/EV05/EV07/EV09; Axe 0 in those matrices and visible keyboard focus confirmed. |
| G09 | Source changes reviewed | PASS | EV11; source diff is limited to nine UI files listed above; no API, data, or dependency files. |
| G10 | No source edit outside approved scope | PASS | EV11; isolated UI branch only. No Push, Merge, Production, EXE, or commit was performed. |
| G11 | Source/runtime parity for the UI candidate | PASS | EV13; served `/login` embeds the current build ID, all nine static assets match the build output byte-for-byte, and the final authenticated Browser regressions ran against the same loopback runtime. |

## H. Final Acceptance

| ID | Acceptance item | Status | Evidence / notes |
|---|---|---|---|
| H01 | Real findings recorded for the complete inventory | PASS | EV01–EV14; all 29 source routes and four blocked page conditions listed. |
| H02 | Every safely editable page is fixed | PASS | Seven affected pages were fixed/rechecked; 18 others were kept unchanged; four route-level dependencies are explicitly deferred. |
| H03 | No old problematic layout remains on a page marked PASS | PASS | EV02–EV10, EV14; route and role Browser evidence on pages marked PASS. |
| H04 | Every BLOCKED/DEFER item has a reason and dependency | PASS | Page Inventory and A05/A12 name the exact Master SHA gate, active Task 2 files, missing patient token, or state-changing dialog boundary. |
| H05 | Every changed page has traceable evidence | PASS | EV04, EV05, EV07, EV10, EV14 and Page Inventory evidence references. |
| H06 | UI regressions found during validation are fixed and rechecked | PASS | EV07 rechecked corrected hit areas; EV14 rechecked Admin/ANC navigation, Logout and current build. Master SHA errors were preserved as blocked source gates. |
| H07 | Git branch, commit, and source hash are recorded | PASS | Branch and base HEAD are above; no new commit was created. EV11 records exact source patch SHA-256. |
| H08 | Task 1 Candidate, Task 2, and Task 1.5 are unaffected | PASS | F09–F11 and isolated UI worktree status. |
| H09 | Final change summary is complete | PASS | Implementation summary, source list, route inventory, validation and blockers are included. |
| H10 | Only verified scope is presented for Owner review | PASS | The candidate is ready for testing in the verified scope; blocked routes and state-changing dialogs remain explicitly marked BLOCKED. |

## ANC Navigation & Logout — owner-approved addendum

| ID | Acceptance item | Status | Evidence / notes |
|---|---|---|---|
| AN01 | Every applicable ANC route has no left sidebar | PASS | EV04, EV14; current authenticated `/cases` and `/doctors` views use the ANC top bar with zero visible left sidebars at 1440/768/375. EV04 includes the case detail route. |
| AN02 | ANC top navigation has all and only real routes the role may access | PASS | EV04, EV14; actual links remain `/`, `/cases`, `/doctors`, derived from existing route permissions. |
| AN03 | Active route is visibly and accessibly identified | PASS | EV04, EV14; current build marks `/cases` and `/doctors`; EV04 covers `/cases/[id]` → `/cases`. |
| AN04 | Logo is left; username and Logout are right | PASS | EV14 screenshots at 1440/768/375 show NIPT-CBH, the signed-in display name and Logout on the right. |
| AN05 | Existing Logout workflow invalidates the authenticated session | PASS | EV04, EV14; mobile ANC Logout redirects to login and `/api/me` returns 401; prior EV04 DB revocation check remains valid. Admin DB revocation is also verified in EV14. |
| AN06 | Desktop 1440px | PASS | EV14; current production build measured in light/dark, no overflow, Axe 0. |
| AN07 | Tablet 768px | PASS | EV14; current production build measured at 768px, no overflow, Axe 0. |
| AN08 | Mobile 375px | PASS | EV14; current production build measured in light/dark at 375px, no overflow, Axe 0. |
| AN09 | Light and dark modes | PASS | EV14; both themes checked at 1440px and 375px. |
| AN10 | Thai wrapping and responsive layout | PASS | EV14; Thai menu labels at 1440/768/375, document and body widths equal the viewport. |
| AN11 | Keyboard navigation and accessibility | PASS | EV14; named menu and logout controls; Axe found zero violations across all measured sizes and themes. |
| AN12 | LAB sidebar/navigation remains unchanged | PASS | EV04, EV14; LAB_STAFF retains the global LAB navigation and gets 200 for worklist API; ANC still has no LAB menu and receives 403 for that API. |
| AN13 | Authenticated ANC and LAB Browser regression | PASS | EV04, EV14; ANC and LAB_STAFF signed in with only their existing roles; routes/APIs and mobile ANC Logout/session rejection checked. |

## ANC / ADMIN / LAB NAVIGATION

| ID | Acceptance item | Status | Evidence / notes |
|---|---|---|---|
| N01 | Role resolution uses existing application roles and permissions | PASS | EV04, EV11, EV12; current layout/navigation ACL props are reused; no mock role or permission change. |
| N02 | ANC-only user receives top nav and no left sidebar | PASS | EV04; authenticated ANC route matrix and screenshots. |
| N03 | ANC menu is route/permission-derived and active state is correct | PASS | EV04; exact links `/`, `/cases`, `/doctors`, active path and direct case detail tested. |
| N04 | Admin uses one global navigation set across ANC/LAB/Settings with no duplicate ANC navigation | PASS | EV14; one visible global navigation set at desktop and in the mobile/tablet drawer; no ANC topbar or nested ANC menu. |
| N05 | Admin follows the Owner-approved system-wide routes; direct `/lab` is allowed and active state is correct | PASS | EV14; `/lab` deep link returned 200 and active state was correct; all 12 global menu destinations and five nested Settings routes returned 200. |
| N06 | APP_ADMIN has system-wide access while ANC and LAB_STAFF retain their existing permissions and navigation | PASS | EV14 and the AS02–AS04 source/service tests; APP_ADMIN gets authorized workspace APIs, ANC gets 403 for LAB/Settings APIs, and LAB_STAFF gets 403 for Settings. |
| N07 | LAB sidebar and navigation links are unchanged | PASS | EV04; exact current href list verified at 1440/768/375 and drawer route changes verified. |
| N08 | Other roles retain the shared navigation shell | PASS | EV04; CLINICAL_APPROVER shell and case-route behavior remain global. |
| N09 | Direct/deep routes and refresh keep role-aware layout and active route | PASS | EV04; direct `/doctors` refresh, ANC case detail, and Admin Settings deep routes checked. |
| N10 | Mobile navigation and Logout work for tested affected roles | PASS | EV04, EV05, EV14; ANC top nav and APP_ADMIN/LAB_STAFF drawer; Admin menu opens by keyboard and is usable at 768/375. |
| N11 | Logout remains single, existing, and session-invalidating across roles | PASS | EV04, EV05, EV14; existing action, login redirect, post-logout `/api/me` 401 and an Admin DB `revoked_at` check. |

## APP_ADMIN System-wide Access — owner lock 2026-10-24

| ID | Acceptance item | Status | Evidence / notes |
|---|---|---|---|
| AS01 | APP_ADMIN remains the only system-wide administrator role; no new role or assignment path is added | PASS | Existing role enum in `packages/security/policy.ts`; no migration or role-enrollment change in the diff. |
| AS02 | Every permission-matrix action is classified exactly once as system-wide or restricted for pure APP_ADMIN | PASS | `tests/permissions/matrix.test.ts` exhaustive classification; focused regression run: 873/873 tests passed. |
| AS03 | APP_ADMIN reads ANC dashboard data across units while existing ANC scope rules remain unchanged | PASS | `tests/db/anc-dashboard.test.ts` Admin cross-unit test; Admin/ANC/LAB negative checks in `tests/permissions/admin-system-wide.test.ts`. |
| AS04 | Pure APP_ADMIN cannot sign as a patient, certify/release a result, approve clinical/QC/historical decisions, enable production HIS, or bypass owner gates | PASS | `tests/permissions/admin-system-wide.test.ts` and `tests/permissions/matrix.test.ts`; P5 signer/actor suite is tracked separately in AS19. |
| AS05 | Authenticated APP_ADMIN can move ANC → LAB → Settings in one session | PASS | EV14; one authenticated session opened `/`, `/cases`, `/lab`, and `/settings` with active links. |
| AS06 | Direct `/lab` deep link and refresh work for APP_ADMIN | PASS | EV14; fresh Admin session opened `/lab` directly and refreshed/rendered the LAB page, HTTP 200. |
| AS07 | Every existing LAB menu link opens its actual route for APP_ADMIN | PASS | EV14; all 12 menu routes plus five Settings subroutes opened with HTTP 200 and a rendered heading; Page Inventory still records the separate Task 2 UI-source boundary. |
| AS08 | APP_ADMIN has one global navigation set, with correct active route and no nested/duplicate ANC menu | PASS | EV14; one visible global nav at desktop, one drawer nav at tablet/mobile, route `aria-current` checked; no ANC topbar. |
| AS09 | Page guards, server authorization, and authorized API checks work for APP_ADMIN | PASS | EV14; authenticated role was exactly `APP_ADMIN`; direct `/lab` and 20/22 authorized API reads returned 200; Bench/Workbook returned the Owner/master 409 gate rather than an authorization denial. |
| AS10 | APP_ADMIN reaches actual authorized LAB APIs for worklist/batches, results, historical records, and Run Photos | PASS | EV14; 22 API checks covered P4 worklist/batch/detail, P4B pooling, P4C sequencing, Bench/Workbook, P5 results/detail, P5H batches/detail/template, Sample Storage, Run Photos search/gallery, doctors, Settings/HIS, audit and health. 20 returned 200; the two master-dependent APIs returned 409 `TASK_MASTER_PATH_REQUIRED`. |
| AS11 | Admin Navigation works at Desktop 1440px | PASS | EV14; 1440px Admin/LAB and Settings, light/dark, no horizontal overflow; Axe 0. |
| AS12 | Admin Navigation works at Tablet 768px | PASS | EV14; 768px drawer opens from keyboard, contains all 12 menu links and Logout; no overflow; Axe 0. |
| AS13 | Admin Navigation works at Mobile 375px | PASS | EV14; 375px drawer, all menu links and Logout accessible; mobile Logout invalidated the session; no overflow; Axe 0. |
| AS14 | Light/Dark Mode, Thai wrapping, and responsive layout work on Admin routes | PASS | EV14; light and dark at 1440/768/375; Thai labels, document/body width and rendered routes checked. |
| AS15 | Keyboard navigation and accessibility checks pass on Admin global navigation | PASS | EV14; Tab reached all 12 mobile menu links, Enter opened Settings, Escape closed the native dialog; Axe found zero violations at measured widths/themes. |
| AS16 | Existing Logout invalidates the Admin session and subsequent authenticated requests fail | PASS | EV14; mobile Logout redirected to `/login`, `/api/me` returned 401, and the session hash row showed `revoked_at IS NOT NULL`. |
| AS17 | ANC retains its top navigation and original authorization without Sidebar or privilege changes | PASS | EV14; ANC roles remain exactly `ANC_NURSE`, top nav has `/`, `/cases`, `/doctors`, no sidebar; LAB worklist and Settings APIs remain 403. |
| AS18 | LAB_STAFF retains the LAB navigation and original authorization without privilege changes | PASS | EV14; LAB role remains exactly `LAB_STAFF`, `/lab` and worklist remain accessible (200), Settings remains absent/403. |
| AS19 | Clinical sign-off identity and audit trail are unchanged; APP_ADMIN alone cannot use those identities | PASS | `tests/db/p5-results-flow.test.ts`, `tests/db/p5-result-identity.test.ts`, `tests/db/p5-paper-link.test.ts`, `tests/permissions/matrix.test.ts`; 946/946 tests passed across 16 files, including P5 identity and authorization regressions. |
| AS20 | Cross-role regression covers APP_ADMIN, ANC, LAB_STAFF, Certifier, Approver, Auditor, IT, and Historical Verifier | PASS | `tests/permissions/matrix.test.ts`, `tests/permissions/admin-system-wide.test.ts`, `tests/db/anc-dashboard.test.ts`, `tests/db/run-photos.test.ts`, `tests/db/p7-result-parity.test.ts`; focused run 873/873 and broader role/API run 946/946 passed. |
| AS21 | Typecheck, lint, and production build pass on the combined UI/RBAC candidate | PASS | `npm.cmd run typecheck`, `npm.cmd run lint`, and `npm.cmd run build` passed on the current tracked source; build ID is `kMVGlWDs_JYup6J2Wm7g8`. Five existing dynamic filesystem tracing warnings remain in unrelated routes. |
| AS22 | Built runtime matches source, and Task 1 Candidate / Task 2 source remain untouched | PASS | EV14: build ID in `/login`; 13 static assets match `.next/static` bytes; synthetic health 200. UI diff contains no Task 1 candidate files, Task 2 Sample Storage files, migrations, or Task 1.5 changes; Task 1 candidate worktree clean at `cf70065d8eed6f3096f870ebd683035db666d98d`. |

## Blockers and readiness decision

1. **Task 2 Sample Storage:** `/sample-storage` is inventoried and browsed, but its component/CSS are active Task 2 files. No UI edit was made there. It remains deferred until that task releases the surface.
2. **Owner-locked workbook master:** prior Browser evidence shows an expected/available SHA mismatch; the current authenticated API receives 409 `TASK_MASTER_PATH_REQUIRED` because the loopback runtime has no task-master path configured. No source/master replacement, path substitution, or hash bypass was performed.
3. **Patient signing:** `/p2/signing` is Owner-locked and requires a valid patient token. Only the no-token synthetic error screen was inspected; no signing was submitted.
4. **Workflow dialogs:** the source inventory is complete and navigation drawers are tested, but all workflow dialogs were not opened because some require state-changing QC/import/clinical actions. A12 remains BLOCKED.

APP_ADMIN now reaches all 12 global menu routes, including ANC, LAB and Settings, plus five Settings subroutes; direct `/lab` and 22 authenticated API calls were exercised (20 HTTP 200; two 409 `TASK_MASTER_PATH_REQUIRED` at the Owner/master gate). ANC and LAB_STAFF retain their existing boundaries. Admin/ANC desktop, tablet and mobile checks passed, with zero Axe violations and no horizontal overflow; mobile logout invalidated the session. The candidate is **HISTORICAL TECHNICAL RESULT (superseded by Owner Visual UX rejection)**. Only A05 (Owner-locked Master SHA) and A12 (state-changing workflow dialogs) remain BLOCKED; no unchecked criterion is labeled N/A.

## Supplemental Synthetic Local UAT Admin credential matrix — 2026-10-24

The account-only Admin seed was applied to five loopback-only runtimes whose configured mode and isolated database names were Synthetic. The Browser runner read the password from ignored local seed data; it did not embed or record the password. The authenticated browser run verified `/api/me` as exactly `APP_ADMIN`, visited ANC (`/cases`), LAB (`/lab`), Settings (`/settings`), and confirmed that Logout redirects to `/login` and the subsequent `/api/me` request returns 401.

| Runtime | Local URL | Seed | Login / Role | ANC | LAB | Settings | Logout / Session | Result |
|---|---|---|---|---|---|---|---|---|
| ui-status-remediation | `http://127.0.0.1:19928` | PASS | PASS / APP_ADMIN | PASS 200 | PASS 200 | PASS 200 | PASS / 401 | PASS |
| task2-storage | `http://127.0.0.1:19828` | PASS | PASS / APP_ADMIN | PASS 200 | PASS 200 | PASS 200 | PASS / 401 | PASS |
| home-preview | `https://127.0.0.1:19443` | PASS | PASS / APP_ADMIN | PASS 200 | PASS 200 | PASS 200 | PASS / 401 | PASS |
| p8-synthetic | `https://localhost:18443` | PASS | PASS / APP_ADMIN | PASS 200 | PASS 200 | PASS 200 | PASS / 401 | PASS |
| synthetic-release | `https://localhost:8443` | PASS | PASS / APP_ADMIN | PASS 200 | **FAIL 404** | PASS 200 | PASS / 401 | **FAIL** |

The `p8-synthetic` and `synthetic-release` health endpoints label their app mode `synthetic-foundation`; both runtime configuration records are Synthetic and their isolated database names are `nipt_synthetic_compose`. The Synthetic Release landing menu contains Overview, Health, and Settings links but no LAB link; its `/lab` route returns 404. This is an installed-runtime route gap, not a login or session failure. No source, Auth/RBAC logic, or database schema was changed to mask it.

Supplemental runtime target counts: **4 PASS / 1 FAIL / 6 BLOCKED / 0 N/A**. The six excluded targets are the protected Task 1 Candidate and five runtimes configured with `NIPT_MODE=operational`; no credential seed or database changes were made there. The earlier 127-item UI/RBAC checklist totals remain scoped to its primary UI candidate; these supplemental runtime counts do not replace or hide them.

## Technical notes and handoff

- Build/typecheck/lint all passed. The build printed five existing dynamic-filesystem tracing warnings in API/workbook code outside the UI diff. The Impeccable detector found one existing `transition: width` warning on `.photo-progress` at `src/app/globals.css`; that rule is outside the changed hunks and was left alone. EV14 binds current browser/runtime parity to build ID `kMVGlWDs_JYup6J2Wm7g8`.
- A previous broad Playwright baseline run on the base source reported 46 passed / 41 failed / 4 skipped / 3 not run, primarily stale selectors/fixture differences. It was not rerun as a full suite after these presentation-only edits; the current affected-route/authenticated Browser regressions are the explicit passing evidence in EV04–EV09. No full-suite pass is claimed.
- Base commit is `1a4055ac8136f10684e8a818e458b4341b22a439`; UI source changes remain uncommitted on `feat/ui-status-detail-remediation-20261024`. No Push, Merge, Production action, or Update EXE was performed.
- Primary Local UAT: `http://127.0.0.1:19928` (health endpoint returned `{"status":"ok","mode":"synthetic"}`). Existing synthetic usernames: `synthetic.anc`, `synthetic.admin`, `synthetic.lab`, `synthetic.approver`. The supplemental `admin` account seed is local-only; password is delivered directly in the owner handoff, not included in this report.
- Local runtime is loopback-only. This is technical Browser evidence using synthetic fixtures, not hospital, clinical, or Owner acceptance.

**Primary UI/RBAC Acceptance:** HISTORICAL TECHNICAL RESULT (superseded by Owner Visual UX rejection) — 125 PASS / 0 FAIL / 2 BLOCKED / 0 N/A. Current Admin system-wide access checks pass; Owner acceptance of the blocked workflow criteria remains pending.

**Supplemental multi-runtime Admin credential acceptance:** 4 PASS / 1 FAIL / 6 BLOCKED / 0 N/A. The credentials work on all five seeded runtimes, but full ANC/LAB/Settings access is not ready across every runtime until the Synthetic Release package provides its missing `/lab` route.


## Visual corrective action — Owner rejection

Initial visual status: FAIL for `/inbound` connection status, `/results` import panel, and `/health` Runtime Services. Before screenshots: `.local/visual-corrective/before/` (1440/768/375 px, light/dark). Prior 125 PASS results remain historical technical evidence and do not establish visual acceptance. Implementation and internal visual review completed on final build `SXB2ejevuheqkRKHTdYfq`; Owner visual acceptance remains pending.

### Corrective evidence and decision (authoritative latest result)

**11 PASS / 0 FAIL / 1 BLOCKED / 0 N/A** in the corrective criteria below. PASS refers to implementation and internal evidence review; it does not override the Owner rejection or certify Owner visual acceptance. The three areas were initially recorded FAIL before implementation. The original Master/workflow blockers remain outside these counts.

| ID | Corrective criterion | Result | Evidence |
|---|---|---|---|
| VC01 | Preserve actual Before images at matching route/role/viewport/theme | PASS | `.local/visual-corrective/before/`: 18 PNGs, APP_ADMIN, 1440/768/375 px, light/dark |
| VC02 | Connection status uses compact grouped facts and prominent main status | PASS | `/inbound`; matching Before/After images show labels above values, scan/result/backlog pairs grouped; existing data expressions retained |
| VC03 | Import hierarchy shows next action, folder, scan rules and latest import clearly | PASS | `/results`; next-step text changes with folder/upload tab; same actions, handlers and validation; matching screenshots |
| VC04 | Runtime summary separates services, recent activity, queue/data and readable alerts | PASS | `/health`; service strip, two semantic groups, Thai severity text; technical codes retained in disclosure; matching screenshots |
| VC05 | Review every definition-list component family | PASS | 10 components in `pattern-inventory.json`; 9 actual routes in `pattern-review/report.json`, registration review and photo metadata dialogs separately captured |
| VC06 | Responsive and both themes preserve grouping, wrapping and readable hierarchy | PASS | 18 After PNGs plus 36 route-review captures and 8 dialog captures; all measured route views have no document overflow; visual inspections include Thai labels, long paths and hashes |
| VC07 | Status truth and content are preserved | PASS | Before and After both show Worker OFFLINE/STALE, Renderer NOT CONFIGURED, Backup/File Store unavailable; health values still read from original `systemHealth`; no status made healthy for presentation |
| VC08 | Functional regression preserves authorization, navigation, Logout and import behavior | PASS | `functional/report.json`: 6/6 checks; APP_ADMIN routes/APIs, ANC top nav, LAB/ANC restrictions, session revocation; folder/upload tab check; isolated P5 flow tests logged separately |
| VC09 | Final source build is served and static checks pass | PASS | Build `SXB2ejevuheqkRKHTdYfq`; 13 byte-identical assets, synthetic health 200; final build/typecheck/lint logs |
| VC10 | Protected task and backend surfaces stay outside corrective edits | PASS | Corrective edits affect markup/CSS and the Health presentation contract test; no Task 1 Candidate, Task 2 source, Task 1.5, API, DB schema, business/Auth/RBAC source changes |
| VC11 | Root cause is evidence based | PASS | `root-cause.json` and source-before snapshots: Inbound/Health source equal base HEAD; Result Import retained old facts layout; shared wide-grid CSS and absent before/after criteria explained below |
| VC12 | Owner accepts the corrected visual UX | BLOCKED | Pending Owner review of actual Before/After and running UAT; automated tests and internal review cannot supply this acceptance |

### Root cause

- `src/app/(protected)/inbound/page.tsx` and `src/app/(protected)/health/page.tsx` before this corrective change were byte-equivalent (normalized line endings) to base HEAD. These two page layouts were not remediated in the prior round.
- `src/components/p5/result-workspace.tsx` had prior checkbox touch-target changes, while its wide label/value facts block remained. The preserved source-before snapshot and Before screenshot show this unchanged hierarchy.
- Global `dl` used `minmax(160px,1fr) minmax(0,2fr)` and `.plan-dl` used a 1:3 split. No grouped-facts primitive covered these areas. Corrective markup groups each dt/dd pair, and opt-in `.compact-facts` puts the label above its value.
- Prior evidence emphasized HTTP, overflow and Axe, and its Before/After example was ANC `/cases`; it did not prove a visual change in these three areas. Those technical results cannot establish the rejected visual acceptance.
- The observed old runtime layout agrees with the preserved old source. There is no evidence that a stale runtime was the primary cause. The final runtime is independently tied to its build and static asset bytes in `functional/report.json`.

### Actual pattern inventory

| Route | Component / surface | Review evidence |
|---|---|---|
| `/inbound` | `src/app/(protected)/inbound/page.tsx` | Before/After + pattern route matrix |
| `/results` | `src/components/p5/result-workspace.tsx` | Before/After + upload/folder tab check |
| `/health` | `src/app/(protected)/health/page.tsx` | Before/After + alert accessibility contract |
| `/settings/backup` | `src/app/(protected)/settings/backup/page.tsx` | Pattern matrix, compact backup facts |
| `/cases/fc8ba24e-1636-46f4-a98e-7f0ac217884e` | `src/components/p2/case-workspace.tsx` | Pattern matrix, current clinical facts |
| `/cases` → registration review dialog | `src/components/p2/registry.tsx` | `registration-*.png`; 0 register API requests; no confirmation |
| `/lab/batches/19c0dcb5-e1cc-4935-9d9b-13e9af4f6300` | `src/components/p4/batch-workspace.tsx` | Existing grouped TaskContext retained; ungrouped planned facts corrected; pattern matrix |
| `/results/87e1486c-eb62-485b-b223-56d19ecebcfb` | `src/components/p5/result-review.tsx` | Pattern matrix, provenance/metadata facts |
| `/lab/photos/19c0dcb5-e1cc-4935-9d9b-13e9af4f6300` → photo dialog | `src/components/run-photos/run-gallery.tsx` | `photo-detail-*.png`, existing metadata opened without editing |
| `/settings/run-photos` | `src/components/run-photos/storage-settings.tsx` | Pattern matrix, path/status/history facts |

Full-resolution same-size comparison gallery: `.local/visual-corrective/comparison.html`. Before/After use the same APP_ADMIN role, route, widths and themes. Live timestamps can differ; their values were not substituted or mocked. Root cause and actual source snapshots are retained beside the gallery.

Local UAT: `http://127.0.0.1:19928`, username `admin` (password provided in owner handoff). The web UI is running from the final build. Worker and Renderer warnings already existed in Before and remain visible; no claim of complete worker/import execution readiness is made. No Production, Push/Merge or EXE action occurred.
