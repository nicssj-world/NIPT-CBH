# P8 focused operations evidence

Status: synthetic technical preparation exercised on native PostgreSQL **17.11**, 2026-10-14 Asia/Bangkok. Clinical acceptance, AL-7, hospital RPO/RTO, physical operations and deployment acceptance remain **pending**. P7's [113-table recovery baseline](../p7/recovery-evidence.md) is reused; this task adds worker recovery, migration failure, operator truth boundaries and a small operational backup/restore drill.

## Operator probe

`tools/p8/health.ts` emits `NIPT_P8_OPERATOR_HEALTH_V1` JSON, with exit 0 only for `technicalReady=true`; non-ready and probe failure return exit 1. Use a separately controlled operator database connection through the environment. The probe needs read access to migration/audit/settings/queue tables and role/lock metadata; application-role grants were not expanded. It executes a repeatable-read, read-only transaction, uses bounded connection/statement timeouts, and never emits database URLs, credentials, identities, settings payloads, audit payloads or raw errors. A failed probe emits only `OPERATOR_PROBE_FAILED` and false readiness.

```powershell
$env:NIPT_MODE='synthetic'
# DATABASE_URL is provisioned separately for the intended synthetic database.
npx tsx tools/p8/health.ts
```

The JSON separates database reachability, `workerAlive`, `workerRecentSuccess`, `inboundEnabled`, migration equality, audit integrity, receipt consistency, role restrictions, release count and clinical authority. Worker alive requires both a non-future heartbeat within 90 seconds and the real worker's database-scoped singleton advisory lock. A restored recent heartbeat alone cannot satisfy this check. The lock is a technical worker signal, not proof of integration or clinical readiness. `technicalReady` additionally requires a successful job within 90 seconds, no reported worker error, zero pending unreceipted jobs/reconciliation/orphan or cancelled receipts, exact migration files/checksums, a valid audit chain, restricted actual `nipt_web`/`nipt_worker` logins plus `app_rw`/`worker_rw` groups, zero clinical releases and false release authority. Missing roles or elevated login privileges fail closed.

This is a fresh-smoke readiness result: an idle newly restarted worker, or a worker with no success in the last 90 seconds, can be alive while readiness remains false. Inbound being disabled is reported independently and does not prevent the isolated PDF smoke. Clinical and hospital operational acceptance always remain false, including when technical readiness is true. Static HTTP `/api/health` is still liveness only.

## Dedicated native rehearsal

The controller provisioned a new cluster under ignored `.local/p8/cluster`, bound to `127.0.0.1:55461`, owner `nipt_p8_synthetic_owner`. `tools/p8/operations-rehearsal.ts` rejects any other host/port/owner/admin database, URL query/fragment or non-synthetic mode before mutation. It creates fresh UUID source/restore databases and retains evidence; it never cleans existing databases or controls the cluster lifecycle. Renderer port **3301** was used; existing port 3001 was untouched.

```powershell
$env:NIPT_MODE='synthetic'
$env:NIPT_P8_OPS_URL='postgresql://nipt_p8_synthetic_owner@127.0.0.1:55461/nipt_p8_synthetic_admin'
$env:PG_BIN='C:\Program Files\pgsql\bin'
npx tsx tools/p8/operations-rehearsal.ts
```

Latest completed drill: `.local/p8/operations-9b7b94c15f2040199ee7bb812e8a0df5/report.json`. Source database `nipt_p8_synthetic_ops_9b7b94c15f2040199ee7bb812e8a0df5`; restored database `nipt_synthetic_restore_p8_9b7b94c15f2040199ee7bb812e8a0df5`. All targets and artifacts remain ignored and isolated. The earlier `operations-f7ab62cc981f400abf9d59f670586764` report predates the worker-lock health correction and is superseded. An initial retained attempt stopped at an assertion because a restarted idle worker correctly had no recent success; the final drill explicitly records that condition and runs a new smoke.

| Focused check | Observed |
|---|---|
| Fresh preparation: migrations, queue schema, reviewed roles | 700 ms; 24 migrations; initial worker absent/readiness false |
| Migration idempotency | Exact ledger unchanged on repeat |
| Modified migration copy | Checksum rejection; applied SQL untouched |
| New failing migration in copied directory | Created test table rolled back; ledger unchanged |
| Real `nipt_web` and `nipt_worker` logins | Non-superuser; release INSERT, audit UPDATE and public DDL each denied (6 actual denials) |
| Renderer unavailable | Worker records error, no completion receipt, readiness false while worker alive |
| Unexpected worker interruption | Only owned worker PID 15064 killed after retry/error recorded |
| Durable recovery | Recorded retry and separately queued Pending job completed after worker/renderer restart; 5405 ms |
| Repeated worker restart | Original two receipts/results unchanged; idle readiness false; new third PDF smoke succeeds |
| Backup / restore | 1568 ms / 683 ms, actual encrypted backup/restore scripts |
| Recovery comparison | All 3 committed job receipts/results and migration ledger exact; file inventories/hashes exact; restored audit valid |
| Observed loss | 0 committed job receipts lost at quiescent backup barrier; no hospital threshold asserted |
| Clinical boundary | Release rows 0, release authority false, inbound disabled, clinical acceptance false |

Backup began after the owned worker and renderer stopped and the pool closed. Only this dataset's writers existed. The source quiescence assertion is operator supplied; the scripts do not orchestrate service stops. The existing P7 encrypted V2 backup format, separate new file/P6 archive destinations, restored role reapplication and immutable asset checks were reused. The restored runtime was not activated or automatically cut over.

The completed report's restored health has a 2.493-second persisted heartbeat and recent success, but `workerLockHeld=false`, `workerAlive=false`, `technicalReady=false`. After the final actual-login privilege correction, a separate **read-only** probe of that restored database was retained as `health-readonly-final.json`: database reachable, migrations/audit/roles valid, release rows 0, authority false, no worker lock, readiness false, expected exit 1. No recovery drill was repeated for this correction.

## Verification and limits

`npx vitest run tests/unit/p8-health.test.ts`: **19 passed**. Regressions cover fresh successful worker with disabled inbound, worker absence/staleness/future heartbeat/missing singleton lock, missing recent success, worker error, backlog/reconciliation/receipt issues, release authority/count, migration/audit/role failures, exact ledger inventory, missing or elevated actual runtime logins, output allowlisting and dedicated-target URL query/fragment rejection. Focused ESLint and `npx tsc --noEmit` pass. Integrated suite/deployment checks belong to the controller's final evidence.

Timings are single small synthetic observations. They establish neither approved RTO nor expected hospital throughput. Receipt loss is measured only for committed work included in the quiescent backup; it does not establish a WAL/archive recovery window. The owned process was killed after a recorded renderer retry, not during PDF rendering or a host power failure. Native localhost filesystem behavior, an empty clinical dataset and local trust authentication do not attest hospital LAN/NAS/CIFS permissions, key escrow, physical printer/device behavior or clinical acceptance. Final signed Compose/service interruption evidence is separate. Worker/renderer processes created by this rehearsal stopped; the dedicated PostgreSQL cluster remains under controller ownership.
