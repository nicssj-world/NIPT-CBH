# HIS Parse Error Dismissal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let HIS operators delete a parse-error row from the database while retaining a minimal tombstone, audit trail, duplicate suppression, and the registration block until valid replacement data arrives.

**Architecture:** Migration 201 records append-only file review events. Migration 202 adds a scoped purge function, immutable tombstone, hash-based scan suppression, and tombstone supersession events. A guarded API deletes only `ParseError` rows; unresolved tombstones remain registration blockers. Discovery marks older file rows and tombstones superseded only after a valid replacement with the same path and LN has been stored.

**Tech Stack:** Next.js App Router, TypeScript, PostgreSQL, existing permission matrix and audit chain.

**Spec:** `docs/superpowers/specs/2026-11-06-his-parse-error-dismissal-design.md`

## Global Constraints

- Delete only an explicitly confirmed `ParseError` row; preserve immutable source sightings, a minimal tombstone, and audit evidence.
- Never delete, rename, or write the raw HIS/NAS source file. Unresolved tombstones remain registration blockers.
- Auto-supersede only when a valid newer file shares both source path and LN.
- Keep PHI out of review events and audit details.
- Do not change Lab/Pooling workflow or read/write HIS/NAS paths from the UI.

## Review Focus

- Repeated deletion: the guarded function and content-hash tombstone prevent duplicate deletion and re-import, including concurrent scans.
- Dismissed unresolved identity errors: remain blocked for registration.
- Same LN at a different source path: never supersedes another path's error.
- Corrected file with a changed LN: does not supersede the prior error.
- Unauthorized or non-ParseError file id: API rejects without writing an event.

---

### Task 1: Persist safe review history

**Files:**
- Create: `db/migrations/201_his_inbound_parse_error_review.sql`
- Modify: `packages/db/roles.sql`

**Interfaces:**
- `his_inbound_file_event` stores append-only `DISMISSED`, `RESTORED`, and `SUPERSEDED` events.
- The registration guard ignores only parse-error files with a later `SUPERSEDED` event; dismissed files remain blockers. Runtime grants permit the web to read/write manual events and the worker to read/write automatic events.

- [x] Add migration and runtime grants with an immutable-event trigger.
- [x] Add grants to `packages/db/roles.sql` for fresh installations.

### Task 2: Guard dismissal and restoration

**Files:**
- Create: `packages/inbound/file-review.ts`
- Create: `src/app/api/p3/inbound/files/[id]/route.ts`
- Modify: `src/server/p3/inbound.ts`
- Modify: `src/components/p3/inbound-actions.tsx`

**Interfaces:**
- `reviewParseError(db, user, fileId, action)` checks `his.scan` write permission and state; `delete` removes only the selected `ParseError` row while retaining its tombstone, and `restore` remains available for legacy dismissed rows.
- Route operations: `delete`, `restore`. Both require authenticated, CSRF-validated POST requests.

- [x] Add the guarded service and API route.
- [x] Add a client control with busy, error, confirmation, refresh, and accessible status behavior.

### Task 3: Supersede validated old versions and present history

**Files:**
- Modify: `packages/inbound/discovery.ts`
- Modify: `packages/inbound/queue.ts`
- Modify: `src/app/(protected)/inbound/page.tsx`

**Interfaces:**
- After a new parsed row is stored, supersede older `ParseError` rows only when `source_path` and parsed LN match.
- `inboundQueuePage` returns active files and closed parse errors separately with independent totals and pagination.

- [x] Add automatic supersede events and audit after successful parse/store.
- [x] Hide dismissed/superseded rows from the active file list and expose them in a collapsed history section with restore for dismissed rows.
- [x] Add Thai copy that says dismissal only hides the row, while the error remains unresolved until a corrected version parses.

### Task 4: Verify the implementation

- [x] Re-run `npm run dev:verify` after the final review fixes; Node/dependencies, lint, TypeScript, all 67 selected test files, migration rehearsal, and migration inventory passed (429s).
- [x] Run the focused HIS inbound contract (23 tests), worker-role contract (6 tests), and the delete/replacement regressions.
- [x] Rehearse all 131 migrations on an empty database and apply the two pending migrations on top of `HEAD`; the migration integrity probes passed.
- [x] Review the final diff for permission, data-retention, migration, and UI scope. Migration 198 remains byte-identical to `HEAD`.
- [ ] Run clean-commit `npm run release:preflight`, staging deployment, and the required synthetic workflow UAT.

### Task 5: User amendment — delete the file row and suppress duplicate scans

**Ruling:** The user chose physical deletion of the `ParseError` row with a minimal tombstone. Keep the raw HIS/NAS file untouched, preserve source sightings and audit history, and keep unresolved tombstones as registration blockers. Exact content duplicates are not new files; same LN with different bytes remains a distinct candidate version.

- [x] Add a scoped database function and migration 202 that delete only `ParseError`, retain path/hash/LN/version/actor/time, and serialize with same-hash inserts.
- [x] Keep immutable source sightings while unlinking the purged parent; preserve audit and remove only child review events during controlled purge.
- [x] Skip tombstoned hashes on future scans and supersede matching tombstones only after a valid newer file from the same path and LN is stored.
- [x] Keep unresolved tombstones in the registration blocker.
- [x] Replace **ปิดรายการ** with **ลบรายการ** and confirmation copy; display only unique content and do not append interval scan history for duplicate-only scans.
- [x] Add regression coverage for exact-byte duplicates, physical deletion with source preservation, repeat-scan suppression, and valid worker replacement of a tombstone.
- [x] Cover valid duplicate sightings across source paths, stable streamed hashes for oversized files, and prevent the production `nipt_worker` login from forging review events, including a temporary-table shadowing regression.
- [x] Remove tombstone row locks that required write privileges on immutable records; audit supersession against the original UUID rather than the SHA-256 text.
- [ ] Obtain explicit Owner approval for destructive migration `202_his_inbound_parse_error_purge.sql` before Production.
