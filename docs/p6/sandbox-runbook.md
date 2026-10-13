# P6 local sandbox workflow (synthetic only)

Never use an existing session/Production DB. Provision isolated local PostgreSQL 17 named nipt_p6_synthetic_*; apply the application migration runner, existing roles.sql and additive packages/p6/grants.sql. Tests create fresh DBs on a dedicated loopback container and leave P5 release tables empty. prepare-db.ts now applies P6 grants; it was not invoked against shared databases.

Enrollment needs a trusted setup login granted p6_fixture_writer only (NOLOGIN by default); web/worker must not inherit it. Native/E2E tests provision actual non-superuser setup/app/worker logins. Run/cancel/confirm/reconcile need worker privileges; status/history can use app/report read grants. No auth/session bypass or HTTP endpoint exists.

```powershell
$env:NIPT_MODE='synthetic'
$env:NIPT_P6_SANDBOX_ENABLED='yes'
# Inject isolated DATABASE_URL for the appropriate login, not a shared session URL.
node --import tsx tools/p6/sandbox-workflow.ts enroll 701 SYNTHETIC-LOCAL-RUN
# Switch to the isolated worker login for queue/evidence operations.
node --import tsx tools/p6/sandbox-workflow.ts run
node --import tsx tools/p6/sandbox-workflow.ts status
node --import tsx tools/p6/sandbox-workflow.ts history '<transfer-uuid>'
node --import tsx tools/p6/sandbox-workflow.ts confirm '<transfer-uuid>' OPERATOR SYNTHETIC-OBSERVER SYNTHETIC-EVIDENCE
node --import tsx tools/p6/sandbox-workflow.ts cancel '<transfer-uuid>' WITHDRAWAL
node --import tsx tools/p6/sandbox-workflow.ts reconcile '<transfer-uuid>' OBSERVED_SANDBOX_DELIVERY SYNTHETIC-OBSERVER SYNTHETIC-INVESTIGATION
```

Enrollment accepts a numeric bundled fixture index and sandbox ID, never arbitrary PDF/P5 data. Identical enrollment reuses a transfer; an existing fixture cannot change sandbox ID. Different runs use separate databases/IDs. The worker role cannot enroll. The normal application worker drains the same journal only with explicit opt-in; without it no P6 query/filesystem action occurs.

Files stay beneath the module-derived application root `.local/p6-sandbox/<SYNTHETIC-id>/`. No root override or live share is configurable. Directories must be disjoint synthetic relative paths; marker/ancestor/reparse/hardlink checks apply. Keep this private sandbox inaccessible to other writers. Local complete-file hardlink promotion is tested; hospital shares, power-loss durability and ACLs are not certified.

SYNTHETIC_CONFIRMED is **not HIS confirmed**. CLI evidence correlates to frozen fixture hashes, not an actual receiver ACK. OBSERVED_SANDBOX_DELIVERY records investigation and never clears replay HOLD. Ambiguous OK/partial cancellation/UnknownTimeout/admin failure retain evidence. No command deletes final files, overwrites conflicts or promotes fixtures. A proven private staging twin may be cleaned pre-OK only with exact inode/device/hash/ownership checks; OK twins remain ambiguous.

```powershell
# NIPT_P6_NATIVE_URL opts into the dedicated local P6 test server; each run creates a fresh DB.
node node_modules/vitest/vitest.mjs run
node node_modules/@playwright/test/cli.js test --config tools/p6/playwright.config.ts
npm run typecheck
npm run lint
npm run guard
npm run build
npm audit --omit=dev
npm audit
```

No reset/clean of an existing database is needed. native-crash-child.ts is a test dependency only: exits 91 after sandbox hardlink, never a production worker entry point. Other phases' optional native/legacy tests stay opt-in and are reported separately. Local tests do not pass AL-5/AL-6.
