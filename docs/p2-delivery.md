# P2 restricted synthetic delivery

Authority: Owner lock `NIPT-CBH-AL2-20261012-001` and Synthetic Start Order dated 2026-10-12. Baseline: `4cc73997af51878599e744738198572256a66f4e`. Source documents remain read-only; hashes and supersession are recorded in [source-register.md](source-register.md).

This record covers P2 technical implementation using synthetic identities and signatures. It does not authorize clinical eligibility, real consent, actual HIS integration, Production migration or deployment. Outstanding human and governance acceptance is tracked in [p2-governance.md](p2-governance.md).

## Implementation and verification status

Restricted synthetic backend/UI implementation and local integrated gates include the final I1–I3 correction wave after `e320ffca67f411972bb282d18ed719339bc3b976`. Earlier task reviews closed Spec PASS / Quality Approved; whole-branch review then required this correction wave. The scoped rereview passed as recorded below. Exact-SHA remote CI remains a delivery gate. The portability correction passed its remote run; a later documentation-only commit exposed a registration-helper timing assumption. The latest test-only correction and its pending remote verification are recorded below. Clinical/governance acceptance remains blocked by the outstanding evidence, rather than treated as implemented clinical authority.

| Area | Implementation |
| --- | --- |
| Registration | Shared case/LN registration service for ANC and LAB_DIRECT; LN/HN string identity, duplicate reopening, scoped search and fail-closed identity conflict |
| Request | Five categories, typed unknowns, versioned drafts, immutable locked revisions, separate per-round collection provenance and raw BMI/GA calculations |
| Clinical | Versioned fact assessment and audit; every assessment remains `passed:false`; pending, conflict and synthetic negative states do not establish approved clinical policy |
| Paper/mixed | Independent Request/Consent modes; minimal Pending recording and separate authorized template/round-bound verification with append-only amendment/replacement history |
| Signing | Twelve server-timestamped acknowledgments, explicit simulated patient decision and vector signature, capability/CSRF protection, frozen staff session and preparer reauthentication |
| Doctor registry | Synthetic maker/checker versions, authorization/effectivity and preserved stored-signature snapshots; no claim of fresh physician signing |
| PDF | On-demand Thai A4 locked snapshot rendering, synthetic watermark, unsigned Consent draft, session-authorized ephemeral bytes for preview/download/print |
| Withdrawal | Immutable W0/W1 revocation and gate hold, evidence retention and PendingGovernance disposition; no HIS void or later-phase execution |

Core source is in `packages/p2/{schema,service,signature,documents,denial}.ts`, `src/server/p2/http.ts` and `src/app/api/p2/`. PDF rendering is in `packages/pdf/p2.ts` and `apps/renderer/main.ts`. Runtime grants/session suspension extend `packages/db/roles.sql` and `packages/security/session.ts`. P2 UI lives in `src/components/p2/`, the existing protected registry/case pages, the doctor registry and the isolated `/p2/signing` page. Existing P1 HIS wire modules are outside the P2 change set.

## Review corrections

The resume preflight preserved four inherited local P2 commits (`b0ab490`, `0f141ce`, `26e1b5f`, `456e65d`) and all uncommitted UI/document changes. Fetch confirmed `origin/main` at the P1 baseline with no remote commits to reconcile. P3 remained a separate worktree/branch; no reset, clean, force push or P3 merge was performed. Existing backend implementation was reviewed and tested rather than rewritten.

Backend review identified and corrected scoped list limiting, document-level signing cardinality, stale completion finalization, exact database evidence/hash binding and prior-round P2 date chronology. Supporting corrections cover consistent active doctor selection, kind-specific paper fields, durable authenticated-denial audit and contradictory paper history. Forward migration 007 preserves migration 006 and existing evidence.

Scoped follow-up review also identified two case/signing-row lock inversions. Patient capability operations, staff return and retry now share case-before-signing ordering with binding revalidation. Deterministic native tests cover completion/cancellation versus return, expiry retry in both acquisition orders and an in-flight completion crossing expiry. The new tests reproduced deadlock against frozen prior source; those deliberate negative runs are not counted as passing gates. Backend review closed with Spec PASS / Quality PASS at `456e65d4e40ea055a1a134302e5f1bce09f2ba0f`.

The resumed UI work was committed at `b746237`; visual inspection then corrected Request category scroll/title/close visibility, with six reviewed Request images recorded at `5aed86f`. Independent UI review identified autosave surviving discard, transient signing reads falsely shown as expiry, local/UTC exposure-time shifts and aggregate validation paths without actual field targets. Correction `ec6a5e7` cancels pending/queued writes on discard/unmount, pauses saves during the close decision, distinguishes saved/in-flight data from discardable edits, recovers capability reads without falsely thawing staff, uses explicit Bangkok instant conversion for exposure/doctor fields and maps validation consistently to real controls. Discarded mode choices also reset to persisted values. Six additional browser regressions exercise real delayed HTTP saves, transport failures, midnight/minute time roundtrips, conditional focus and mode reset.

Final whole-branch corrections address I1–I3 in one scoped wave:

- **I1 signing recovery:** consumed/expired capabilities recover only a narrow authoritative outcome for the original preparer and staff session. `POST /api/p2/reauthenticate {action:'status'}` requires original staff CSRF and Origin, returns only `{sessionId,outcome}`, and never thaws or finalizes. Password return now requires `{password,attestation:true,sessionId,outcome}` with an exact server match under the unchanged case-before-signing locks. Granted/Declined uses the positive read/choose/sign-in-presence assertion; cancelled/expired/invalidated uses the device-return assertion. Unknown status offers retry without an assertion form or consumed-capability cancellation. The server always reports `consentFinalized` on successful return, and the UI uses that result. Replay, stale completion and original-preparer restrictions remain enforced.
- **I2 complete history:** directly scoped case detail now returns `history:{rounds,events}` independently of registry pagination, with complete prior-round collection facts and CASE_DETAIL_VIEW auditing. The workspace consumes that history instead of the legacy globally limited timeline and silent current-round fallback. No new round-operation workflow was added.
- **I3 per-page PDF identity:** reserved print headers/footers repeat LN/HN/round, SYNTHETIC / NOT FOR CLINICAL USE, pinned template/snapshot, hash, generation time and Page N of M on every actual A4 page. Automated PDF extraction checks each page, body text/image geometry and nonempty body content for long Request and unsigned/Granted/Declined Consent. Thai body sizes and evidence are preserved.
- **M1 pagination refinement:** doctor heading/signature/caption and patient decision/signature/times stay together where they fit; metadata no longer creates footer-only overflow. Further compaction is non-blocking and deferred: a normal unsigned fixture with a stored doctor image still uses a second page for the grouped doctor block, now with complete repeated identity and synthetic marking. Long forms are allowed to span pages; no evidence was dropped or Thai text shrunk to force a page count.

New final-consent evidence declares `PG_JSONB_CANONICAL_V1`; PostgreSQL constructs/verifies the canonical JSONB hash and authoritative signing provenance. Existing `JS_CANONICAL_V1` evidence is retained without rewriting its hash. See [architecture.md](architecture.md) and [migrations.md](migrations.md).

## Database changes

Only `006_p2_synthetic.sql` and forward `007_p2_consent_document_uniqueness.sql` were added for P2. Migration001–005 remain byte-for-byte unchanged. All seven applied ledger checksums were verified against source on isolated native/browser databases; the real local browser runtime used `nipt_web`/`app_rw` without superuser, CREATEDB or CREATEROLE. Migration owners are confined to prepare/seed/test administration. Checksums and migration behavior are recorded in [migrations.md](migrations.md). No Production migration, migration090, ledger repair, or deletion/rewrite of ambiguous legacy consent evidence was performed.

## Traceability and implementation locations

| Acceptance group | P2 implementation / verification target | Boundary |
| --- | --- | --- |
| AT-ANC-01–06, AT-LDR-03 | `packages/p2/schema.ts`, `packages/p2/service.ts`, P2 registration/case APIs; domain, database and native contract tests | Synthetic identity only; no specimen receipt or Halos allocation |
| AT-CG-01–03/05–07/09, AT-ANC-07 | Versioned assessment, unknown/date/source facts and immutable acknowledgment evidence | Clinical `Pass` and disputed A/B thresholds remain unapproved; positive examples prove data flow, never clinical eligibility |
| AT-ANC-08, AT-PAPER-02–07 | Independent modes, Pending recording, template/round-bound paper review and immutable lineage | Batch entry and S2+ operational acceptance remain P4 |
| AT-CON-01–06 | Synthetic doctor versions, patient capability, twelve acknowledgments, vector signature, final evidence and preparer return | Synthetic draft text/signatures; no representative electronic signing or fresh doctor signature |
| AT-CON-07–08, AT-PRV-01–05 | Controlled PDF service and renderer, actual Thai/A4 PDF tests, session/expiry/access checks | Locked Request or unsigned prepared Consent; P1 Result PDF storage unchanged |
| AT-REV-01–06 | W0/W1 revocation, retained evidence and PendingGovernance hold | W1b/W2–W5 and real HIS/result disposition remain later-phase acceptance |
| AT-LDR-04/07 and permissions | Deny-default service policy, staff signing freeze and post-rollback denial audit | No bypass endpoint or expanded hospital role authority |
| AT-UX / AT-UXQ, OD-24 UQ-1–11 | P2 UI/browser/accessibility evidence recorded separately | Automated checks do not establish operator UAT, full manual conformance or Owner visual approval |

Acceptance rows that span P2–P6 are split at the authorized P2 boundary rather than marked wholly passed. Source plan details remain authoritative; unresolved clinical interpretation is recorded in [p2-governance.md](p2-governance.md).

## Final evidence

Local integrated verification on 2026-10-12 (Windows, Node24.15, Chromium, loopback PostgreSQL):

| Gate | Actual result |
| --- | --- |
| `npm run typecheck` | PASS, exit0, final corrected UI source |
| `npm run lint` | PASS, exit0, no ESLint warnings |
| `npm run guard` | PASS, 193 source/artifact files; prohibited archive/data/credential patterns absent |
| `npm test` with native `NIPT_TEST_DATABASE_URL` | **23 files / 888 tests PASS**, no skips, **54.93s**; Unit/DB/Migration/Contract/Permission/native concurrency/PDF/P1/P2 regression |
| `npm run test:e2e -- --reporter=line --trace=off`, `E2E_SKIP_VISUAL=1` | **35/35 PASS**, no skips, **1.2m** (runner-rounded duration) on fresh `nipt_synthetic_p2_browser_closed2`; 8 P1 +27 P2, including six final-wave recovery/history cases |
| Windows visual batch2, `--update-snapshots=changed` | **24/24 PASS**, no skips, **51.5s** at pre-lifecycle-fix UI source; only six expected Request images changed, individually inspected and committed at `5aed86f` |
| `npm run simulator` | PASS, 100 synthetic PET/OK pairs created; native contract/worker tests above exercise existing integration logic |
| `npm audit --omit=dev --audit-level=high` | PASS, zero production-dependency vulnerabilities |
| `npm run build` | PASS, exit0; three existing P1 dynamic-filesystem tracing warnings retained, no new P2 build warning |
| Migration ledgers/runtime role | 001–007 source checksums matched on isolated native/browser databases; `nipt_web` is a non-superuser member of `app_rw`, without CREATEDB/CREATEROLE |
| Original/P1 preservation | Seven source-document hashes unchanged; OD-24 hash unchanged; P1 migrations001–005 and HIS integration/worker source unchanged from baseline |

The final 35-test run includes registration mismatch/authorization, all four independent modes, rawBMI40.004 and age/GA0, autosave/version-conflict/offline/discard races, conditional paper evidence/amend/replace/decline, actual HTTP403 with durable denial audit, simulated grant/decline/cancel/expiry/stale return, frozen staff/original preparer return, identical PDF bytes/cross-session denial, withdrawal retention, responsive/axe/keyboard and Bangkok instant roundtrips. Native tests additionally cover direct constraints, final-evidence provenance/cardinality/hash, capability replay/bypass and deterministic signing/return/retry races. No result from an intentionally failing old-source deadlock proof is counted as PASS.

Visual work used exactly two batches. The later lifecycle/time/error fixes were functionally tested without new screenshots; they do not turn the older visual pass into an exact-final-source pixel comparison. Timestamp/expiry masks are explicit; no failed screenshot was silently approved. Formal Owner baseline acceptance remains pending. The earlier seven-page PDF raster inspection remains historical evidence only. This wave added no UI screenshots, raster inspection or baseline regeneration. Separate final-source automated PDF evidence covers seven synthetic fixture variants /20 actual pages: long Request5; normal unsigned/Granted/Declined Consent2 each; long unsigned/Granted/Declined Consent3 each. Repeated identifiers/metadata, A4 dimensions, nonempty body and reserved header/footer geometry are machine evidence; they do not establish final visual approval, legal template acceptance or physical printing quality. Remaining doctor-block continuation compaction is disclosed under M1 above.

The reproducible gate uses an isolated local synthetic PostgreSQL database through `NIPT_TEST_DATABASE_URL`, a separate fresh seeded browser database and the authenticated local renderer. It runs `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run guard`, `npm audit --omit=dev --audit-level=high` and `npm run test:e2e`. Native tests must actually run; a result with their optional database checks skipped cannot be reported as the full gate.

Windows Chromium screenshot comparison and Linux CI accessibility/functional checks are separate evidence. CI retains its explicit `E2E_SKIP_VISUAL=1` setting for Windows-recorded baselines; it does not automatically approve or regenerate screenshots. GitHub Actions must complete successfully for the final pushed SHA and `origin/main` must resolve to that SHA. A local production build proves compilation only.

### Git delivery and CI record

Inherited commits were preserved; UI implementation `b746237`, reviewed visual assets `5aed86f` and correction `ec6a5e7` extend them on main. The final correction commit preserves them and all migrations001–007. No force push, reset, clean, Production deployment or P3 merge is part of delivery. The reviewed P2 branch was pushed at `035e61a6474f901f926b6ce4c3e0d465de78ab14`. [First CI run 38231988271](https://github.com/nicssj-world/NIPT-CBH/actions/runs/38231988271) **FAILED**: native 888 and gates through build passed, while browser 32 passed /3 failed. A new test/workflow portability correction is recorded below; its exact-SHA remote CI completed successfully as recorded below. [Current main workflow](https://github.com/nicssj-world/NIPT-CBH/actions/workflows/foundation.yml) is the live remote evidence, not a substitute for checking its exact SHA.

## OD-24 UX criteria: evidence is not operator acceptance

The original Plan §8.6.3 and OD-24 remain binding. This table separates implementation evidence from outstanding human acceptance; it does not replace or relax the eleven gates.

| Gate | Technical evidence / disposition | Outstanding evidence |
| --- | --- | --- |
| UQ-1 | Flow/wireframe documented in [p2-ux.md](p2-ux.md) before UI implementation | Actual ANC/Lab representative review/signatures not obtained |
| UQ-2 | Existing tokens, 16px main text, 4/8 spacing, local Thai font and shared label/help/error patterns retained | Hospital design acceptance pending |
| UQ-3 | Automated 375/768/1280/1440 responsive/overflow checks and long Thai screenshots | Actual target-device review pending |
| UQ-4 | All-impact A/AA axe, browser keyboard checks and additive per-screen [ACR](accessibility.md) | Every applicable WCAG2.2 A/AA criterion, manual/NVDA/zoom/text-spacing and incomplete findings still need human review; no conformance claim |
| UQ-5 | Real loading/empty/error/validation/success flows, offline retry and identity/permission/conflict negatives | Operator comprehension acceptance pending |
| UQ-6 | Stable controls and loading state structure implemented | Measured CLS **<0.1** not established; no fabricated performance PASS |
| UQ-7 | Native modal containment, Escape/dirty-close/opener regression checks | Actual hospital keyboard/AT review pending |
| UQ-8 | Thai recovery instructions for conflicts, permissions, pending clinical and stale Consent | Operator wording acceptance pending |
| UQ-9 | Windows visual batches reviewed by implementer/controller; configured **0.1%** pixel threshold retained | Owner-approved baseline/signoff remains pending; implementation screenshots are not formal approval |
| UQ-10 | Shared ANC/LAB_DIRECT service and one case workspace; distinct justified blind identity entry | Hospital journey/step-count validation pending |
| UQ-11 | Automated synthetic journeys only | Actual **2–3 ANC and 2 Lab users**, completion **≥90%**, **0** critical patient/mode/round errors and **SUS≥70** remain NOT TESTED / NOT SIGNED |

## Remaining acceptance

Clinical/DPO/DCC approval, controlled legal templates, representative electronic-signature policy, hospital role/device acceptance, actual ANC/Lab UAT, full manual accessibility/NVDA and Owner visual acceptance remain outstanding. Automated browser evidence is narrower than operator UAT. P3–P8 retain their own integration, physical laboratory, result certification, recovery and release gates; see [p2-governance.md](p2-governance.md) and [next-phases.md](next-phases.md).

## P2–P3 integration handoff

[p2-p3-handoff.md](p2-p3-handoff.md) records the actual `registerP2` interface, LN/HN pair HMAC and leading-zero semantics, immutable `p2_case_identity`, shared LN lock and registration transaction, blind-entry boundaries, secret-file ownership and migration/grant requirements. Existing P1 synthetic PET identity digests differ from the P2 pair digest; LN-only matching cannot silently reconcile them. `linkIntakeAtRegistration` and migration090 remain subsequent integration work, not a P2 export or applied migration. Draft PR #1 is not merged or approved by this delivery.

## Final technical review disposition

Whole-branch review found three Important issues; the single correction wave at `7abf6059fb298e268b51e13d315244a429526e2a` addressed completed-signing recovery/attestation, complete authorized older-case history and every-page PDF identity/restricted-use marking. The scoped re-review concluded **Spec PASS / Quality APPROVED WITH NON-BLOCKING MINOR**, with **0 Critical / 0 Important / 1 Minor** and no new breakage identified. The local final-source checks above support restricted synthetic delivery; exact-SHA remote CI is recorded in the verified remote record below.

Residual M1: further compacting an unsigned Consent's grouped stored-doctor block is deferred. It may occupy a continuation page, now bearing full identity, template/snapshot references, page numbering and synthetic marking. No footer-only overflow remains. This is a non-blocking print-layout refinement, not a claim of hospital printer, legal-template or Owner visual acceptance. Cost of this decision if operator review disagrees: a later scoped layout adjustment and renewed PDF checks; immutable evidence must remain intact.


## CI environment portability correction

The first pushed run's three failures were the durable doctor-denial audit, expired-signing fixture and older-case history fixture. Workflow configuration omitted `NIPT_E2E_AUDIT_DATABASE_URL`: two tests fell back to local port 55432 and failed ECONNREFUSED on CI, while history attempted to parse an absent URL. The tests' local-only database-name guard would also reject CI's reserved `nipt_synthetic_ci` name. These were CI environment defects discovered after the completed technical review, separate from the final-review correction wave; the failed run is retained as failed evidence.

The workflow now explicitly sets the browser fixture/audit URL to the app's same loopback 5432 `nipt_synthetic_ci` database. Native `nipt_synthetic_test_ci` remains separate and unchanged. One shared test helper requires explicit fixture and app URLs, synthetic mode, PostgreSQL protocol, loopback host and either the exact reserved CI browser name or a reserved local `nipt_synthetic_p2_browser` name/suffix. It rejects query/fragment target overrides and requires matching app host, effective port and database before connecting; fixture-owner and app-runtime roles may differ. All three tests retain their audit, expiry, history, scope and freeze assertions without skipping or relaxing the guard. Local browser runs must explicitly export both matching URLs instead of relying on `.env.local`'s older P1 target.

Covering local verification of this infrastructure correction: **22 helper tests PASS**, the **3 affected browser journeys PASS in 7.6s** against fresh `nipt_synthetic_p2_browser_ciportability`, plus typecheck/lint and source guard **195 files PASS**. Traces were disabled and visual tests excluded; no screenshots/baselines or application/domain/PDF/migration behavior changed. The earlier full 888-native/35-browser results above remain the final application-source evidence; full native/build/browser suites were not rerun for this test/workflow-only correction. At that local checkpoint, corrected-commit remote CI was pending. The subsequent successful exact-SHA run is recorded below; it does not establish success for later commits.

## Verified remote delivery record

Verified 2026-10-12: corrected implementation/test-infrastructure commit `d3fa8864d7813d42554332a6b9c11c655500fe27` was pushed normally to `origin/main`; the remote SHA matched. [GitHub Actions run 38233999769](https://github.com/nicssj-world/NIPT-CBH/actions/runs/38233999769) completed **SUCCESS** for that exact SHA. All steps completed successfully, including isolated migration/seed preparation, simulator, guard, typecheck, lint, native tests, dependency audit, production build, browser checks and artifact upload. Decoded job logs independently confirm **24 native test files /910 PASS**, **35 browser PASS (1.4m)**, **guard195 PASS** and **0 production-dependency vulnerabilities**. No test failure or skip was reported in the successful run. The first failed run and its causes above remain part of the record.

The controller also ran the final native source locally after the fixture-helper addition: **24 files /910 PASS**, no skips, **53.59s**. The final full local browser35 PASS and targeted portability3 PASS are separately described above; they are not added together as38 distinct tests. New22 helper safety tests are included in910, not added again. This remote evidence supersedes the earlier888-test local count for the integrated test tree.

This successful checkpoint applies to `d3fa8864d7813d42554332a6b9c11c655500fe27`. The documentation-only follow-up `3d74eea7901297ab63c8d20b51778cf025881844` triggered another run, which failed as recorded below. Latest-commit remote delivery remains pending; [main workflow runs](https://github.com/nicssj-world/NIPT-CBH/actions/workflows/foundation.yml) remain independently inspectable. The disclosed non-blocking M1 layout refinement remains unchanged. Clinical/DPO/DCC, manual accessibility/CLS, operator UAT and Owner visual acceptance remain pending. P3 PR#1 remains Draft/unmerged, and no Production/HIS operation or clinical release was performed.


## CI registration prerequisite correction

[GitHub Actions run 38235288418](https://github.com/nicssj-world/NIPT-CBH/actions/runs/38235288418) at documentation-only commit `3d74eea7901297ab63c8d20b51778cf025881844` **FAILED**: native **910 PASS**, browser **34 PASS /1 FAIL**; the other gates through build passed. The failed journey was `acknowledgment survives transient refresh and reconciles before cancel`. Controller inspection of the actual trace's text/network established that it never reached signing: the shared registration helper opened the dialog before the asynchronous units response arrived and submitted an empty required unit. No registration POST occurred, and the dialog remained open with its placeholder selected even after the actual unit option loaded. This is a test prerequisite timing assumption; no application defect or signing regression is established by that failure. The earlier successful 910/35 run remains valid for its exact SHA.

The shared browser helper and both manual duplicate/conflict submits now explicitly select the actual fixture `unitId` and assert the selected value before submitting through the UI. Scoped review found the two manual submits shared the same prerequisite assumption; the follow-up correction preserves the deliberate empty-unit negative below. Playwright waits for the real option. One new deterministic regression holds the actual registry response with deferred `route.fetch`/`route.fulfill`, opens and fills the dialog before units arrive, verifies native required-unit validation and zero registration POSTs, releases the unchanged real response, verifies the unit remains empty, selects the actual unit and observes exactly one successful registration POST and its case navigation. All original 35 journeys and their assertions remain; no sleep, timeout increase, retry, API registration bypass or application/domain/PDF/migration/workflow change was introduced.

Local covering verification after the scoped review correction: registry duplicate/conflict, the original failed acknowledgment journey and the new delayed-units regression **3/3 PASS in 7.2s**, plus typecheck/lint and source guard **195 files PASS**. The earlier 2/2 covering run passed in 3.8s; these overlapping runs are not added together as five distinct tests. Explicit synthetic app/audit URLs target the same isolated local browser database; traces and visual checks were disabled. Native/build/full-browser suites were not repeated for this browser-test-only change. The added test makes 36 configured browser journeys; a full 36-test PASS has not been observed here. The latest test correction still requires controller diff review, normal push and successful exact-SHA GitHub Actions before remote delivery can be claimed. No future CI result is assumed.
