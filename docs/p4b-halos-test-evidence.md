# P4b HALOS synthetic test evidence

Execution date: 2026-10-12 (Asia/Bangkok). Worktree: `D:\Claude workspace\NIPT-CBH-P4b`. Base: `10a646f80b1d65837985e18a916eb95bcff0b456`. No real patient data, HALOS, P4 database/API or instrument used.

## Original template

`python tools/inspect-halos-template.py 'C:\Users\User\OneDrive\Desktop\NIPT-Audit\Task Import template.xlsx'` passed. ZIP CRC, SHA-256 before/after, one sheet, exact headers (including LF and Greek μ), 47 rows, string lane, numeric Barcode1–12/14–48, A/C placeholder blanks and absent E cells checked read-only. Original digest: `1e4ffc979235f3221ca637f37476713c3a02bc7a5c541c8d32688f4af9c0caec`, 11,074 bytes. No original XLSX or source audit copied into the repository.

## Automated evidence

| Check | Result / scope |
| --- | --- |
| Base `npm test` before changes | 949 passed, 7 skipped; 26 files passed, 6 skipped |
| P4b focused contract suite | 44 cases included in the final full regression below; no external services |
| Final `npm test` | 993 passed, 7 skipped; 27 files passed, 6 skipped |
| `npm run typecheck` | Passed: Next route generation + TypeScript |
| `npm run lint` | Passed, zero warnings permitted |
| `npm run guard` | Passed, no prohibited source/data/credential artifacts |
| `git diff --check` | Passed |
| `npm audit --omit=dev --audit-level=high` | Passed, 0 production dependency vulnerabilities |
| `npm run build` | Passed; 3 tracing warnings in unchanged PDF-preview/secrets routes; no release/deployment claim |

Final regression includes the independent Python-derived SHA-256 golden fixture test, exact numeric-looking ID preservation, leading zeros and whitespace/suffix preservation. The fixture was serialized independently using Python `json.dumps(sort_keys=True,separators=(',',':'),ensure_ascii=False)` and `hashlib.sha256`; snapshot, ordered-member and cell-plan digests matched the TS output.

The seven local skips comprise six existing native PostgreSQL/concurrency/worker/P2/P3 tests without `NIPT_TEST_DATABASE_URL`, plus one legacy Python differential test without `NIPT_LEGACY_PET_PARSER_DIR`. The local Vitest pass does not prove those paths. This worktree has no local DB configuration. No local Playwright/browser tests were run: no UI changes were made. Existing GitHub CI provisions synthetic PostgreSQL and runs browser checks; its result for the final SHA must be checked separately. No shared or real database was migrated/seeded from this worktree.

`npm ci --ignore-scripts` installed the locked dependencies in this worktree. Its all-dependency audit reported five high-severity findings; the separately executed production-only audit above returned zero. No dependencies or lockfile were changed to address unrelated dev-tool findings.

## Latest commit / CI evidence

The final SHA, Draft PR URL and GitHub Actions result are reported in the delivery response and PR. They must be read together; local checks do not establish remote CI success. This document records checks on the delivered content; it cannot embed its own content-derived commit SHA. No workflow files were changed or checks disabled.

Implementation commit `762f0116212b17912c1426c276975ffe8163d23f` passed both [push CI](https://github.com/nicssj-world/NIPT-CBH/actions/runs/38264767839) and [PR CI](https://github.com/nicssj-world/NIPT-CBH/actions/runs/38264816352). PR job logs confirm 999 Vitest tests passed, 1 skipped, 44 P4b tests passed, 41 browser tests passed, and zero production dependency vulnerabilities. The remaining skip is `tests/contracts/p3-legacy-differential.test.ts`; no extracted legacy parser was configured in CI. All six native opt-in tests ran successfully in isolated CI PostgreSQL. `E2E_SKIP_VISUAL=1`: browser checks are not approval of Windows visual baselines. This subsequent evidence-only revision corrects the local skip classification; no library, fixture or test code changed.

## Limits and pending decisions

See [the contract's pending matrix](p4b-halos-export-contract.md#pending-contracts--decisions). The library produces an internal typed cell plan, not XLSX bytes. Consequently XLSX write/readback, vendor import, all 47 actual instrument associations, actual control identities, partial batches, intended/actual DNB date reissue, P4 snapshot adapter, authorization/audit/currentness and mandatory pre-sequencing verification remain pending. No historical 52-test HALOS ledger or AL-4b acceptance is marked passed.

Scope consists exclusively of the new `packages/halos-export` library, its synthetic fixture/tests, read-only inspection utility and these documents. P4/P2/P3 workflow, migrations, navigation, label printing and ID generators are untouched. Draft PR is held for the final P4 snapshot contract; no merge is authorized or performed.
