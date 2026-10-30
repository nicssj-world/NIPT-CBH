# Codex — NIPT-CBH v1.1.3 Autonomous Completion Directive

Owner instruction (2026-10-30): **Complete all authorized local development and local release gates without stopping at interim reports or asking the Owner to relay status to ChatGPT.** Work in this SAME Codex session/worktree as far as tool/context limits permit.

## Read first
1. `docs/UPDATE-1.1.3-RELEASE-CHECKLIST.md` (authoritative current checklist)
2. `docs/CODEX-HANDOFF-UPDATE-1.1.3-20261030.md`
3. `docs/UPDATE-1.1.3-IMPLEMENTATION-LEDGER.md` (historical; some sections stale)
4. `git status --short`, full diff, source and tests. Preserve everything already done.

## Execution contract
- **Implement → test → investigate failure → repair → retest → update checklist internally → continue to next issue.** Do not end a turn after a mere progress report, summary, a discovered failure, or a handful of green tests.
- No interim handoff to ChatGPT, no requirement for Owner to copy logs or reports between assistants. Keep details and evidence in repo files. Only write a user-facing **final delivery report** after all locally actionable checklist items are PASS, with exact evidence, package SHA256 (if produced), and remaining hospital-only acceptance clearly separated.
- Do not ask for approval already granted for edits, test databases, local synthetic E2E, Chrome/Edge testing, Windows isolated installer rehearsal and local source commits. No new approval for fixing tests, configuration, or local dependencies within this isolated worktree.
- If a tool command fails, investigate and correct it, then continue. If a genuinely insurmountable local external block remains, exhaust available alternatives, mark BLOCKED with reproducible evidence, and continue with independent work. Only ask the Owner when an external action (credentials, hospital access, production push/deploy/install, irrevocable action, or paid tool limit) is strictly unavoidable.
- Autonomous completion may be interrupted by Codex quotas, context, operating-system tool access or approvals. Do not pretend the task completed if interrupted; retain checklist, exact resume instruction and checkpoint. If a new Codex session is required, resume this same worktree automatically from checklist without re-implementing or requesting a new handoff.
- **No Push, Deploy, hospital server/NAS access or real clinical data.** Local test/build/update-only EXE rehearsal allowed; real hospital acceptance is intentionally excluded until separately authorized.
- Never wipe/reset uncommitted code, bypass security gates, disable tests, forge clinical audit or invent PASS. Preserve working v1.1.2 checkout and parent worktree.

## Prioritize
1. P1 complete all actual queue classes/pg-boss, safe Retry/Clear Selected/Clear All, in-flight HIS reconciliation, archive publication races, cancellation idempotency, privileges/audits.
2. P3/P4 verified current-round PET gate and EQA exception, no HIS/RES/CFS across direct, scheduled, replay, repeat, No Call and withdrawal, while ordinary patient clinical workflow remains intact.
3. P0 native PostgreSQL + actual Browser Admin changed HIS path save; P2 Chrome/Edge PWA; P5 real workbook IQC/EQA; P6 safe, bounded PET scan compaction on native PG.
4. Full Unit/DB/contracts/permissions/security/Browser/Word PDF regression. Resolve unverified skips, role grants, build warnings and Git index checkpoint narrowly.
5. Test **update-only** Windows v1.1.2→v1.1.3 installer in isolated Windows rehearsal including rollback, backup/restore, data/credentials preservation, hashes; create release package only if release gates are actually met.
6. Keep `docs/UPDATE-1.1.3-RELEASE-CHECKLIST.md` accurate with evidence and final status.

## Single user-facing response when done
Report one of: **LOCAL GO** (all local release gates PASS) or **NO-GO** (with exact unrecoverable blocking items), list verifiable test evidence and exact artifact paths/hashes, and explicitly separate hospital-only acceptance. No interim summaries.