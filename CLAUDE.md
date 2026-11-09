# NIPT-CBH — Claude Code

Read [AGENTS.md](AGENTS.md) and [Fast Development Pipeline](docs/deployment/FAST-DEVELOPMENT-PIPELINE.md) before any coding. These are the source of truth for every AI agent.

**Development (default):** inspect branch and working tree; use the isolated synthetic `npm run dev` environment and Hot Reload. Edit → `npm run dev:verify` → focused `npm run dev:test -- <test-file>` → repeat. Do not build packages, deploy, run full regressions or use Production to debug.

**Release (only if requested):** prepare a clean commit and run `npm run release:preflight`. Use `npm run release:preflight -- --full` or GitHub Actions for intentional full regression. Risk-based validation never replaces real owner approval or signed packages, verified backups, migrations, health checks and rollback.

**One preflight per batch:** `release:preflight` takes 11–22 minutes. Do not start it until the Owner has confirmed the batch of changes is complete. If scope is added while it runs, ask whether to stop and fold it in (restart) or let it finish and ship the addition in a separate release; never silently run it several times for one deploy. Finish every `npm run dev:verify` and focused test before the single preflight.

`.claude/settings.json` installs a PreToolUse hook for common direct slow commands in Claude Code. Review project hooks when prompted. The hook is advisory enforcement, not a security boundary; unsupported agents and shells must still follow the documented policy. A BLOCKED check is not a PASS.
