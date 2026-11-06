<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Fast Development Pipeline — read this before changing source code

Guide: [docs/deployment/FAST-DEVELOPMENT-PIPELINE.md](docs/deployment/FAST-DEVELOPMENT-PIPELINE.md) (Thai). Read it before touching code; it is the source of truth for the commands below.

- **Default to the Fast Development Loop.** Edit → `npm run dev:verify` (changed files only, seconds) → fix → repeat, in the same working tree. `npm run dev:test -- <file>` runs one test; `npm run dev` / `npm run dev:up -- web worker renderer` start the isolated development stack (127.0.0.1:3100/3101, PostgreSQL 127.0.0.1:55452, data under `.local/dev`, synthetic only). Run `npm run dev:setup` once per checkout.
- **Use focused tests first.** Do not run `npm test` (the whole suite), a signed-package build, `deploy-staging.ps1` or any installer to check a routine source correction. A deterministic failure belongs in the local loop, not in a 30-minute upgrade.
- **Full release validation only when preparing a deployment:** commit cleanly, then `npm run release:preflight` (clean revision, Node/dependencies, pinned assets, environment identity, signing prerequisites, migration rehearsal on an in-memory database, destructive-SQL detection, risk class, production build with provenance stamp). Staging is deployed only when the release policy requires it (integration, installer or release verification), never to test a routine fix.
- **BLOCKED is not PASS.** If a check cannot run (missing asset, key, service), say BLOCKED and why; never report it as passed.
- **Never touch Production** (`C:\NIPT-CBH\production`, ports 3000/3001/443/55432, `deploy-production.ps1`, `upgrade-production.ps1`, `rollback-production.ps1`) without explicit Owner authorization in the current session. Approval for one deployment does not extend to the next.
- **Never bypass** patient-safety rules, migration integrity (applied migrations are immutable; add a new numbered migration), HIS/NAS isolation (development never reads or writes HIS inbound/outbound folders or sends RES/OK/PDF), package signing (Ed25519), backups or rollback protections. Do not edit a pinned SHA-256, a gate or a risk rule to make something pass.
- Development and synthetic tests use only the reserved database `nipt_synthetic_dev*`, loopback hosts and `.local/dev` paths; `tools/dev/dev-env.mjs` enforces this and refuses to start otherwise. Do not point `.env.local` at ports 3000/3001/55432/55442.

## Fast Pipeline Enforcement V2

Claude Code reads `CLAUDE.md` and `.claude/settings.json`; Codex and other agents must follow this file. Development uses focused checks, not full tests and packaging. GitHub CI runs fast checks for every change and full checks for MEDIUM/HIGH or manual dispatch via the existing production risk classifier. No release or patient-safety gate may be bypassed.
