# P6 independent contract delivery — 2026-10-13

Status: independent **pure/synthetic P6 work implemented**; integrated P6 publisher and HIS interface acceptance remain **HOLD**. AL-6 is not passed, P5 release HOLD is unchanged. No real HIS/LAN/CFS connection, database mutation, migration, deployment, push, merge or PR creation occurred.

Branch: `feat/p6-outbound-contract-synthetic`; worktree: `D:/Claude workspace/NIPT-CBH-P6`; base: `5d859c3a8be433b10668a9b097396cf1be69c54e`. Dependency reference: P5 PR #5 head `afa660a84217ec58279babd78fbf0426f62ad4d4` (read only). Only additive P6 files are in the diff. Existing worktrees/branches/shared files are untouched. Node dependencies are reused via an ignored local junction; no dependency manifest/lockfile was changed.

## Implemented

- Pure versioned synthetic RES profile/serializer/strict verifier: UTF-16LE BOM, CR, records/escaping/R[3], explicit frozen times, exact legacy RES/.ok/PDF naming, configurable safe PDF templates, synthetic certifier, invalid input/encoding/length failures.
- Reproducible pinned legacy oracle and 492 byte-exact RES goldens plus seven PDF naming goldens, all synthetic; no original patient samples redistributed or read.
- Frozen synthetic PDF/RES payloads/hashes/config/profile identities and immutable reservation decisions. Same transfer retry reuses N; new report version advances N per original LN/generation; collision never overwrites and cannot be bypassed by changing settings version.
- Pure transfer model for PDF/RES/backup/OK proof order, pre-/post-OK epoch/consent/config checks, capped explicit backoff, partial artifacts, cancellation, admin failure, pickup/timeout/reconciliation and correlated synthetic evidence. Logs are coded and contain no HN/LN/path/free-form failure message. No actual transfer actions or persistence exist.
- Read-only P5 interface reference and held read adapter; production adapter always throws. No fixture or API can turn an unreleased P5 result into a publishable result.

## Validation ledger

Commands run from the P6 worktree. Focused red tests were observed before the new modules existed. Later behavioral red tests reproduced and then closed settings-version collision bypass, object-order fingerprint differences, non-idempotent observation replay and missing reconciliation after a failed first write.

| Check | Result |
| --- | --- |
| Pinned oracle generation | 492 RES / seven PDF synthetic expectations; original/archive/member hashes verified; source members identical between both ZIPs |
| P6 focused tests | 546 passed in three files, no skips |
| Necessary existing HIS/identity regression | P6 + existing `his.test.ts`, `outbound-identity.test.ts`, `publish-identity.test.ts`: **591 passed**, six files, no skips (546 P6 + 45 regression) |
| TypeScript | `tsc --noEmit --incremental false`: PASS |
| P6 ESLint | Only packages/p6 and three P6 test files; zero warnings/errors |
| Source guard | PASS: 285 files; shared guard unchanged |
| Diff whitespace/scope | `git diff --cached --check`; additive P6 allowlist only |

An initial unmodified-baseline run of `tests/contracts` plus `tests/unit/publish-identity.test.ts` and `tests/unit/reconciliation.test.ts` passed **78 tests**, with seven opt-in tests skipped (14 files: eight passed, six skipped). DB helpers used disposable in-memory PGlite; native DB/worker/LAN tests were not enabled. This is baseline evidence only, not P6 integrated acceptance. Final regression is restricted to relevant existing HIS/identity tests. No application build/browser/UI test is claimed for these pure modules.

Read-only reviewer found and verified closure of the notice-whitespace HOLD bypass and selected specimen-evidence suffix validation gap. Whitespace CFS legacy semantics were confirmed through pinned oracle fixtures; freeze rejects blank text. No unresolved important review finding remains in the reviewed fix set. The reviewer did not execute tests; counts here are from the implementing session's actual runs. A second independent generator invocation produced byte-for-byte identical fixture JSON. Metadata tests pin both archives, four member hashes, entry counts and corpus size. SHA numeric-run source-guard false positives were resolved by grouped digest formatting; the shared guard was not changed.

Reproduce scoped checks without loading a database or environment file:

```powershell
node node_modules/vitest/vitest.mjs run tests/contracts/p6-res.test.ts tests/contracts/p6-transfer.test.ts tests/contracts/p6-boundary.test.ts tests/contracts/his.test.ts tests/contracts/outbound-identity.test.ts tests/unit/publish-identity.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js packages/p6 tests/contracts/p6-res.test.ts tests/contracts/p6-transfer.test.ts tests/contracts/p6-boundary.test.ts --max-warnings 0
node --import tsx tools/source-guard.ts
```

Optional dev oracle regeneration (read-only source directory containing the two pinned ZIPs):

```powershell
python -I tools/p6/legacy-goldens.py '<immutable-source-directory>' .local/p6/regenerated.json
```

## Reviewable evidence and limits

- [Detailed source/contract review](contract-review.md)
- [Legacy parity matrix](legacy-parity-matrix.md)
- [P5 dependencies, decisions and AL-6 HOLD](integration-holds.md)

No legacy capability was silently discarded: single/bulk/history/PDF transport/path UI/durable retries/backup/reconciliation are explicitly deferred to P6 integration. Safe naming and wire serialization are delivered now. Real service identity/path acceptance, backup policy, receiver semantics, clinical channels/PIC/certifier mapping, round >=2 specimen-date policy and signed same-LN redraw LAN testing remain required. The pure reservation model does not prove concurrent workers; synthetic confirmation is never HIS confirmation. Findings outside P6 are recorded in the parity matrix, not fixed here.
