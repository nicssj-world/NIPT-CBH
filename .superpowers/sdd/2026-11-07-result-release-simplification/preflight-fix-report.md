# Preflight fix report

## A. LINK_REQUIRES_UNLINKED
Tests that import a PDF then call proposeLink/decideLink now import via `importUnlinked` (auto-link then certifier unlink -> manual path). Assertions unchanged.
- tests/db/p4b-p5-integration.test.ts: p5Link helper uses importUnlinked (fixes 4 tests).
- tests/db/report-run-name.test.ts: external matched version test uses importUnlinked.
- tests/db/task1-external-no-call.test.ts: both importReport calls -> importUnlinked (5 tests).
Other direct callers of proposeLink/decideLink were not failing in the full suite (not touched).
Run: p4b-p5-integration, report-run-name, task1-external-no-call, p5a-auto-link, result-completion: 5 files, 28 tests passed. eslint and tsc --noEmit clean.

## B. workbook-control-highlights.test.ts: PRE-EXISTING
Temporary worktree of 75921eb (node_modules junction, copied .local/lab-owner-evidence) running only this test: FAILED identically (expected $C$6 / received $B$6, G54-G52 vs F54-F52 in the pooling formulas). packages/workbook is unchanged by this branch. Worktree and junction removed. Nothing changed.
