# Isolated UX V2 runtime

This runtime belongs only to `NIPT-CBH-UX-V2-IMPLEMENTATION` / `feat/premium-ux-v2-local`.
Project: `nipt-ux-v2-local-20261017`; web: `https://127.0.0.1:19518/login`; DB: `127.0.0.1:19519/nipt_operational_ux_v2_local`.
Only those two loopback ports are published. Web, worker, renderer have no published ports.

From the implementation worktree:

```powershell
pwsh -File tools/ux-v2/runtime.ps1 -Action Status
pwsh -File tools/ux-v2/runtime.ps1 -Action Start
pwsh -File tools/ux-v2/runtime.ps1 -Action Stop
pwsh -File tools/ux-v2/runtime.ps1 -Action RebuildWeb
```

`RebuildWeb` builds only a local Docker web image, then recreates only this project's web service. It does not make an installer or touch another runtime. HEAD records the base commit; uncommitted UI changes are included, so an image of a dirty tree is not exact-commit release evidence. The existing build contract verifies the migration inventory. Do not use `down -v` or remove `.local/ux-v2` if persistence is needed.

New credentials: `.local/ux-v2/credentials.txt`; machine-readable account list: `.local/ux-v2/secrets/uat-accounts.json`. Do not print or commit passwords. All six accounts use unique fresh passwords: administrator, laboratory staff, certifier, clinical approver, auditor, ANC nurse. Original UAT and design-audit credentials were not copied. Master workbook is a hash-verified local copy; Original Master was never modified.

The database uses operational mode to exercise operational UI with synthetic fixture identities only. HIS inbound/outbound are disabled, outbound production authorization false, and local share policy grants empty. `tools/ux-v2/disable-his.ts` restores those defaults using audited maker/checker services against this exact new DB only. There is no network/hospital/clinical acceptance.

The original full positive-journey helper temporarily enables local simulator HIS settings and is incompatible with this runtime's HIS-disabled scope. Its initial run was stopped; defaults were restored through audited services. Forty-five synthetic cases and three task sheets remain. Full positive journey, native Excel export/PDF, QC3/QC4 and released-result outbound were not completed. Do not replay the original helper here.

Standard browser fixture suites require synthetic database mode and an explicit matching `NIPT_E2E_AUDIT_DATABASE_URL`; do not aim them at this operational-mode DB or weaken their guard. Browser UI checks here should use authenticated Playwright contexts and these local accounts. Unit/permission/contract tests do not require this DB. Test logs live under `.local/ux-v2/` and are ignored.

## Separate P2 browser regression environment

`tools/ux-v2/p2-e2e.ts` creates/uses only Docker project `nipt-ux-v2-e2e-20261017`, fresh DB `nipt_synthetic_p2_browser_uxv2_<randomhex>` for every invocation on loopback `19529`, web `http://127.0.0.1:19528`, renderer `127.0.0.1:19530`. It uses synthetic mode, fresh `.local/ux-v2-e2e` keys and seed password, and identical explicit app/audit DB URLs. It preserves the reserved-browser-database guard. This environment is separate from the operational UI preview.

```powershell
npm run build
npx tsx tools/ux-v2/p2-e2e.ts
```

The runner executes all existing `tests/e2e/p2.spec.ts` tests, writes separate logs/evidence under `.local/ux-v2-e2e`, then stops only its own child processes and DB service. Do not run it while another process owns its fixed ports. Each invocation creates a new database inside its own PostgreSQL cluster. Earlier databases/fixture evidence and the isolated volume remain preserved; no database is dropped or reset. All generated secrets remain ignored.
