# Read-only Genomic allocator evidence

`tools/migration/collect-genomic-watermark.ts` is a future operator utility. Development tests use an in-memory Queryable; this work did not connect to Production.

Use an approved read-only PostgreSQL account in `GENOMIC_READ_ONLY_DATABASE_URL` through the operator's secure session. The utility never reads `DATABASE_URL`, never prints the connection string, and emits only manifest digest, source count, delta counts and the administrative freeze assertion. Do not put credentials in command history or the manifest.

After obtaining a fresh registry Excel and arranging the single allocator authority switch:

```powershell
node --import tsx tools/migration/collect-genomic-watermark.ts --mapping 'C:\approved-transfer\genomic-cbh-ln-mapping.xlsx' --out 'C:\approved-transfer\genomic-watermark.json' --source-identity 'GENOMIC-CBH-approved-source' --source-frozen
```

Omit `--source-frozen` during reconnaissance. That option records an administrative assertion; the collector does not stop intake, change settings, freeze a source or write source records. The source identity is an operator supplied nonsecret label and must not contain a URL or credentials.

The collector starts `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`, verifies PostgreSQL `transaction_read_only=on`, reads every `public.nipt_samples(ln,ln_halos)` pair without LIMIT, and reads `public.nipt_monthly_sequences(sequence_month,last_value)` directly. Excel maximum is never substituted for the allocator. The same snapshot supplies `current_timestamp` and a hashed `pg_current_snapshot()` identifier. The utility commits its read-only transaction or rolls back on failure. Raw source pairs and snapshot token are not written or logged.

The portable manifest pins source label, timestamp, snapshot hash, registry pair digest/count, exact local Excel SHA-256, monthly allocator counters and freeze assertion. Its SHA-256 proves integrity relative to a trusted captured digest; it is not a digital signature or independent proof of source authenticity. Transfer the original Excel and manifest together using the hospital's approved channel. Output uses exclusive creation and refuses to overwrite an existing manifest.

Added, removed and changed pair counts compare the full source to local Excel. A stale export must be re-exported and recollected; no row is silently added to the local Excel. Planner intake remains available while delta/watermark issues are pending. Allocator handover alone remains unavailable until the exact mapping digest, source digest/count, frozen authority assertion and actual allocator reconcile. The execution adapter must also check freshness with explicit `asOf` and `maxAgeMs` (24 hours by default when freshness is requested), and require a fresh actual cutover source comparison rather than assuming a previously generated manifest remains current. Future timestamps are rejected.

Synthetic tests: `node_modules/.bin/vitest.cmd run tests/unit/migration-ingest-watermark.test.ts`. These verify query ordering, absence of source write commands, direct allocator table access, full registry read, stale export rejection, read-only server enforcement and deterministic recency checks. They do not prove connectivity or permissions on the actual Genomic server.
