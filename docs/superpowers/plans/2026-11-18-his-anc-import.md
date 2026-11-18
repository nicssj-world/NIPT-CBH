# HIS ANC Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lab staff upload the HIS ANC `.xlsx` export, see a preview, and confirm; the system saves "ตรวจใบขอส่งตรวจ" on each matched, unchecked case exactly as manual entry, and fills empty weight/height.

**Architecture:** A pure parser (`packages/his-anc/parse.ts`) turns the workbook into normalized rows. A planner (`packages/his-anc/import.ts`) matches rows to cases by CID + HN through the stored PET and decides one outcome per row; `previewHisAnc` returns that plan and `applyHisAnc` re-plans and executes it by calling the existing `paperReview` service per case. One API route and one Lab UI panel call them.

**Tech Stack:** TypeScript, Next.js route handlers, PGlite db tests (vitest), existing `readXlsx` (`packages/readygen/xlsx.ts`), `identityLookup`, `paperReview`, `doctorSkeleton`.

**Spec:** `docs/superpowers/specs/2026-11-18-his-anc-import-design.md`

## Global Constraints

- Fast loop only: `npm run dev:verify` and `npm run dev:test -- <file>`; no full suite, no build, no preflight, no Production.
- Header must be exactly these 20 columns (case-insensitive, trimmed): `hospcode hn cid brthdate pttype age seq date_serv gravida ancno ga ancresult ancplace provider weight height bmi edc nipt_date nipt`.
- Dates are `DD/MM/YYYY` Gregorian; GA is `W+D` (days > 6 carry into weeks).
- Only cases already in the system; never create a case; never overwrite a non-empty value; `pttype` ignored.
- Same as manual: the check is written only through `paperReview(...)` with a short REQUEST panel, `operation:'Review'`, `previousId:null`, `pregnancyType:'Singleton'`.
- Doctor = provider name starting `พญ.` or `นพ.`; others never enter the registry.
- Permission: `paper.verify` (every Lab staff member).
- UI labels are proposed to the Owner as options before any UI text is written (memory: ask-before-ui-wording).
- Synthetic dev rules apply in tests: HN `^0*990…`, doctor keys `SYNTHETIC-…`, names `SYNTHETIC…`, as the existing fixtures do.

## Review Focus

1. A file re-saved by Excel with numeric cells (CID as `1.2E+12`, dates as serials) → parser rejects the row as `HIS_INCOMPLETE`, never fills a wrong CID/date. (Task 1 test `numeric-looking cells`.)
2. Same case appears twice in one file (two visits) → only the newest `date_serv` row is used; the other is `DUPLICATE_IN_FILE`. (Task 2 test.)
3. Preview then a colleague checks the case by hand before confirm → apply re-plans and reports `ALREADY_CHECKED`, no second check. (Task 3 test.)
4. Same file confirmed twice → second run fills nothing (all `ALREADY_CHECKED`), no duplicate doctors. (Task 3 test.)
5. Provider spelled with one-letter difference from a registry doctor → existing doctor used, no new entry. (Task 2 test.)

---

### Task 1: Parse the HIS workbook

**Files:**
- Create: `packages/his-anc/parse.ts`
- Test: `tests/unit/his-anc-parse.test.ts`

**Interfaces:**
- Produces:
  - `type HisAncRow={rowNo:number;hn:string;cid:string;visitDate:string /*ISO*/;gravida:number|null;ga:{weeks:number;days:number}|null;edc:string|null;provider:string;weightKg:number|null;heightCm:number|null;incomplete:string|null /*reason code or null*/}`
  - `parseHisAncWorkbook(bytes:Buffer):HisAncRow[]` — throws `HisAncError('HEADER_MISMATCH'|'EMPTY_FILE'|'NOT_XLSX')`
  - `splitGa(text:string):{weeks:number;days:number}|null`
  - `isDoctorName(provider:string):boolean`
  - `class HisAncError extends Error{code:string}`

- [ ] **Step 1: Write failing tests** (build workbooks in-test the way `tests/unit/p5h-table.test.ts` does, or with `templateXlsx`-style helper)
  - `splitGa('28+0')` → `{weeks:28,days:0}`; `'20+7'` → `{21,0}`; `'13+13'` → `{14,6}`; `'abc'`, `''`, `'28'` → `null`.
  - `isDoctorName('พญ.ทัศพร เชียงทอง')` true; `'นพ. ก'` true; `'น.ส.สุภาวรรณ ใจดี'` false; `'ภญ.x'` false.
  - Header with a missing/renamed column → throws `HEADER_MISMATCH`.
  - A valid row → `visitDate '2026-11-18'`, `edc '2027-02-10'`, `weightKg 99.6`, `heightCm 160`, `gravida 2`, `incomplete null`.
  - `weight '0.0'` → `weightKg null` (row still complete).
  - `gravida '0'` → `incomplete 'G_ZERO'`.
  - `ga '1+0'`, `edc` = visit date → `incomplete 'EDC_GA_MISMATCH'` (rule: |edc − (visit + 280 − GAdays)| > 3 days).
  - numeric-looking cells: CID not 13 digits (e.g. `'1.20900000814E+12'`) or a date not `DD/MM/YYYY` → `incomplete 'BAD_IDENTIFIER'` / `'BAD_DATE'`.
- [ ] **Step 2:** `npm run dev:test -- tests/unit/his-anc-parse.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement with `readXlsx` + `normalizeHeader` from `packages/readygen/xlsx.ts`, first sheet, row 1 header. Missing `edc` is allowed (`edc:null`, no mismatch check); missing/invalid `ga` → `incomplete 'BAD_GA'`.
- [ ] **Step 4:** Re-run → PASS. `npm run dev:verify`.
- [ ] **Step 5:** Commit `feat(his-anc): parse the HIS ANC export workbook (Owner 2026-11-18)`.

### Task 2: Match and plan (preview)

**Files:**
- Create: `packages/his-anc/import.ts`
- Test: `tests/db/his-anc-import.test.ts`

**Interfaces:**
- Consumes: Task 1 `parseHisAncWorkbook`, `isDoctorName`.
- Produces:
  - `type HisAncOutcome='FILL'|'FILL_BODY_ONLY'|'NOT_MATCHED'|'ALREADY_CHECKED'|'ELECTRONIC_REQUEST'|'HIS_INCOMPLETE'|'DUPLICATE_IN_FILE'`
  - `type HisAncItem={rowNo:number;hn:string;outcome:HisAncOutcome;reason:string|null;caseId:string|null;ln:string|null;fills:{doctor?:{name:string;versionId:string|null /*null = will be added*/};gaWeeks?:number;gaDays?:number;gravida?:number;pregnancyType?:'Singleton';weightKg?:number;heightCm?:number}}`
  - `type HisAncPlan={fileSha256:string;counts:Record<HisAncOutcome,number>;items:HisAncItem[]}`
  - `previewHisAnc(db:Queryable,user:Staff,bytes:Buffer,lookupKey:Buffer):Promise<HisAncPlan>` — requires `paper.verify`; read-only.

Rules (in order, per row):
1. `incomplete` set → `HIS_INCOMPLETE` (reason = code).
2. Several rows for one CID+HN → keep newest `visitDate`; others `DUPLICATE_IN_FILE`.
3. Match: `identityLookup(cid,lookupKey)` = `his_inbound_file.parsed->>'identityKey'` AND `ltrim(parsed->>'hn','0')=ltrim(hn,'0')`, joined `his_order_current.inbound_file_id` → round = the case's `current_round_id`, case not voided. None → `NOT_MATCHED`.
4. `p2_workspace.request_mode<>'Paper'` → `ELECTRONIC_REQUEST`.
5. Any `p2_paper_review` REQUEST on the current round with status not in (`Replaced`,`Amended`) → `ALREADY_CHECKED`.
6. Provider not a doctor → `FILL_BODY_ONLY` (reason `NOT_A_DOCTOR`), fills = empty weight/height only.
7. Else `FILL`: doctor resolved against current registry versions by `doctorSkeleton` equality or one-letter tolerance (export `within1` from `packages/migration/doctors.ts`), title stripped; GA = HIS GA + (collection date − visitDate) days, collection date read as `paperReview` reads it (`p2_collection_fact` then `specimen_round_current`); gravida; Singleton; weight/height only where the workspace draft value is null.

- [ ] **Step 1: Write failing db tests** (fixtures: PET-registered cases as in `tests/db/task15-registration.test.ts`; collection date set as in `tests/db/paper-gravida.test.ts`)
  - matched paper case → `FILL`, `gaWeeks/gaDays` shifted by the collection-date gap (visit 2026-11-01 GA `16+2`, collection 2026-11-04 → `16+5`), `gravida`, `Singleton`, doctor `versionId:null` for an unknown `พญ.` name.
  - registry doctor differing by one letter → `versionId` of that doctor.
  - CID right but HN wrong → `NOT_MATCHED`.
  - case already checked → `ALREADY_CHECKED`; electronic request → `ELECTRONIC_REQUEST`.
  - `น.ส.` provider → `FILL_BODY_ONLY` with reason `NOT_A_DOCTOR`, no doctor in fills.
  - draft weight already set → no `weightKg` in fills.
  - two rows same patient → newest kept, other `DUPLICATE_IN_FILE`.
  - preview writes nothing (row counts of `p2_paper_review`, `p2_doctor_version` unchanged).
  - user without `paper.verify` → rejected.
- [ ] **Step 2:** `npm run dev:test -- tests/db/his-anc-import.test.ts` → FAIL.
- [ ] **Step 3:** Implement `previewHisAnc`; `fileSha256` = sha256 of bytes.
- [ ] **Step 4:** Re-run → PASS; `npm run dev:verify`.
- [ ] **Step 5:** Commit `feat(his-anc): match HIS rows to waiting cases and preview what fills (Owner 2026-11-18)`.

### Task 3: Apply

**Files:**
- Modify: `packages/his-anc/import.ts`
- Test: `tests/db/his-anc-import.test.ts` (same file, new `describe('apply')`)

**Interfaces:**
- Consumes: Task 2 `previewHisAnc`, `HisAncPlan`; existing `paperReview`, `REQUEST_TEMPLATE`/operational template choice as `paper-form.tsx` sends it.
- Produces: `applyHisAnc(db:Queryable,user:Staff,bytes:Buffer,lookupKey:Buffer,expectedSha256:string):Promise<HisAncPlan & {applied:number;failed:{rowNo:number;code:string}[]}>`

Behaviour: refuse when sha differs (`HIS_ANC_FILE_CHANGED`); re-plan (never trust the preview); for each `FILL`/`FILL_BODY_ONLY` item inside `SAVEPOINT` per case:
- new doctor: insert like `registerHistoricalDoctors` (version 1, no unit, no signature, `Approved` event, `p2_doctor_registration`), key `HIS-` + 16 random hex (`SYNTHETIC-HIS-…` and `SYNTHETIC` name prefix when `!operationalDataEnabled()`), `authorization_evidence 'IMPORTED_FROM_HIS_ANC_EXPORT'`; a second row with the same new name in the same run reuses it.
- `FILL`: `paperReview(db,user,caseId,{kind:'REQUEST',templateVersion,panel:{all paperSchema keys null,doctorVersionId,gaWeeks,gaDays,gravida,pregnancyType:'Singleton'},operation:'Review',previousId:null})`.
- weight/height: `UPDATE p2_workspace SET draft=…, version=version+1, updated_by, updated_at=clock_timestamp()` setting only keys still null (re-read the draft inside the savepoint).
- one audit row `HIS_ANC_IMPORT_APPLIED` with counts (no CID in details).

- [ ] **Step 1: Write failing tests**
  - after apply, `getCase(...).paper` has one REQUEST check `Verified`; workspace draft has `gravida`, `type 'Singleton'`, `edd` from the check, `weightKg`/`heightCm` filled; existing non-null weight untouched.
  - unknown `พญ.` doctor now in registry and selectable (`listDoctors` includes it); same name on two rows → one registry entry.
  - `FILL_BODY_ONLY` case: no paper check created, weight/height filled.
  - case checked by hand between preview and apply → `ALREADY_CHECKED`, still one check.
  - running apply twice → second `applied:0`, doctor count unchanged.
  - wrong `expectedSha256` → `HIS_ANC_FILE_CHANGED`, nothing written.
  - one case forced to fail (e.g. collection date removed) → listed in `failed`, other cases still applied.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS; `npm run dev:verify`.
- [ ] **Step 5:** Commit `feat(his-anc): confirm the HIS import — save the request check as manual entry and fill empty weight/height (Owner 2026-11-18)`.

### Task 4: API route

**Files:**
- Create: `src/app/api/lab/his-anc-import/route.ts`
- Test: `tests/unit/his-anc-route.test.ts` (follow an existing route test in `tests/unit` that mocks `withTransaction`/session)

**Interfaces:**
- Consumes: `previewHisAnc`, `applyHisAnc`; `uploadedFile(request,'file',8*1024*1024)` from `src/server/task3.ts`; `p2Mutation`, `noStore` from `src/server/p2/http.ts`; lookup key read as `src/app/api/p2/pet-registration/route.ts` does.
- Produces: `POST multipart {file, action:'preview'|'apply', sha256?}` → JSON `HisAncPlan` (apply adds `applied`, `failed`); `HisAncError` → 422 with Thai message map in the route's error handler.

- [ ] Steps: failing test (preview returns plan JSON; unknown action 422; oversize 413) → run → implement → run → `dev:verify` → commit `feat(his-anc): Lab upload route for the HIS import`.

### Task 5: Lab UI panel (Owner picks wording first)

**Files:**
- Create: `src/components/lab/his-anc-import.tsx`
- Modify: the page the Owner chooses (`src/app/(protected)/lab/page.tsx` or the `/inbound` page)

- [ ] **Step 1:** Propose to the Owner: placement (งาน Lab vs รับตัวอย่างจาก HIS), button label, outcome wording for each `HisAncOutcome`. Wait for the choice.
- [ ] **Step 2:** Build: file picker → preview (counts row + table: HN, LN, outcome, what fills) → confirm button → result (applied, failed) with links to cases. Follow the HALOS import preview component's structure (`src/components/p4/halos-operational-panel.tsx`).
- [ ] **Step 3:** `npm run dev`, upload a synthetic workbook, confirm the case page button now reads "แก้ไขใบขอส่งตรวจ" and the request shows G, EDD, weight, height. `npm run dev:verify`.
- [ ] **Step 4:** Commit `feat(his-anc): Lab panel to preview and confirm the HIS import (Owner 2026-11-18)`.
