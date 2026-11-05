# LN Halos Import Implementation Plan

> Execute locally using focused tests and the Fast Development Pipeline.

**Goal:** Import original LN–Halos mappings and bring matched PET specimens into the normal HIS-received task workflow.

**Architecture:** Reuse the existing migration mapping parser, immutable source evidence, PET application, lab gates, and allocator locks; introduce only the minimal durable reservation and integration required for current and future PET matching. Provide an authenticated preview and confirmation workflow.

**Tech Stack:** Next.js route handlers, TypeScript, PostgreSQL forward migrations, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-05-ln-halos-import-design.md`.

## Constraints

- Synthetic data and isolated development database only; production deployment requires its own authorization and release gates.
- No changes to applied migrations, HIS/NAS, signature, backups, or clinical safety gates.
- Preserve existing issued numbers and use the same allocator locks for import and receipt.

## Review Focus

- Repeated imports and conflicting LN or Halos identifiers cannot overwrite cases.
- Pending PET arriving after import must consume the reservation, including concurrent receipt.
- Counter update and reservation must be atomic with respect to issuing new numbers.
- Refused or revoked consent cannot be silently marked ready.
- Importing a mapping without analysis must not classify it as a completed historical result.

## Tasks

1. Inspect installed migration, receipt and allocator contracts, then write focused failing tests for reservation, counter advancement, duplicates and both PET arrival orders. Implement additive database and service changes, running each focused test before and after.
2. Add authenticated preview and confirm endpoints using the existing XLSX parser, provenance, authorization, paper markers, and transaction handling. Test stale previews, repeat submission, conflicts and partial failure.
3. Add the import UI to the lab worklist and show result counts and actionable conflicts. Verify accessibility and the current Next.js route conventions.
4. Run isolated end-to-end synthetic tests proving HIS-received status, unchanged original Halos, paper route, and eligibility for Task List, plus existing relevant regression tests and `npm run dev:verify`. Review changes and report any blocked checks.
