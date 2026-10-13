# P7 synthetic backup and recovery evidence

Status: implemented and exercised locally on disposable PostgreSQL **17.11**, 2026-10-13. Hospital DR/RPO/RTO, NAS/WAL policy, offline key escrow, LAN filesystem semantics and cutover remain **NOT ACCEPTED**. No clinical data or existing containers/databases were used.

## Scope and format

V2 adds database-referenced P6 sandbox artifacts to the encrypted custom-dump/filestore backup. Its encrypted canonical manifest records exact file paths, byte sizes and SHA256, sorted sandbox IDs, fixture/transfer counts and a canonical digest of P6 fixture/transfer/event/reconciliation/heartbeat rows. It contains no credentials or source absolute paths. Source quiescence is mandatory; SHARE table locks and an exported PostgreSQL snapshot bind the database dump. Source filesystem inventories are checked before/after copying. The operator must actually stop writers; no service or deployment action is performed by these tools.

The restricted USTAR codec accepts regular files/directories only. Before extraction it checks header checksums, sizes, padding/end markers, path components, duplicate/case aliases and file/parent collisions; links and extension headers are rejected. Path ancestors are checked with lstat/realpath. Restore targets must be fresh and disjoint. P6 restores to a separate archive root without runtime activation or overlap with the fixed runtime sandbox root. V1 safe pre-P6 archives remain readable; any V1 dump mentioning P6 tables fails closed. The synthetic archive cap is 512 MiB. Stat-based per-file and aggregate archive budgets are checked before source reads, and fixed-size reads reject source growth; oversized sparse-file rejection is exercised without allocating its contents. Scaling this in-memory bounded format to hospital volumes requires separate operational validation.

## Reproducible drill

Provision a **new dedicated** PostgreSQL17 cluster under ignored `.local/p7-ops/cluster`, bound only to `127.0.0.1:55449`, owner `nipt_p7_owner`. Never point this tool at an existing app cluster. Then run:

```powershell
$env:NIPT_MODE='synthetic'
$env:NIPT_P7_OPS_URL='postgresql://nipt_p7_owner@127.0.0.1:55449/postgres'
npx tsx tools/p7/recovery-drill.ts
```

Every invocation creates new UUID databases and ignored evidence directories. Seeded evidence uses actual services/helpers: P2 electronic Request, twelve consent acknowledgments, vector/PNG/hash signature and same-preparer reauthentication/final consent; P4 received round and analytical attempt; imported P5 original PDF/report; P5H second-person promoted historical record; durable P6 transfer and its PDF/RES/backup/OK artifacts. No clinical final state or release row is fabricated.

The drill also generates one controlled diagnostic reparse and one bounded CSV-export evidence row through their actual session-bound services. It invokes the actual scripts as subprocesses and compares every public-table canonical digest/count (including migration checksums, new append-only evidence and all lineage keys), filestore manifest and sandbox artifact manifest. Restored referenced assets are independently read through `FileStore` hash verification. Audit-chain verification passes. Reviewed DB roles are reapplied separately; app release insertion privilege remains false and `p5_release_authorized()` remains false. Historical integrity runs under a read-only transaction, reports zero issues, and leaves all table digests unchanged.

## Observed results

Final measured drill: `drill-2b68d8e159224b87b5d62244c226036a` under `.local/p7-ops` (ignored, retained for review).

| Check | Observed |
|---|---|
| Public tables / total rows | 113 / 168; exact source/restore digests equal |
| Filestore files / P6 artifacts | 3 / 7; exact paths, sizes and hashes equal |
| Audit, lineage, migration ledger | Restored exactly; audit chain valid |
| Clinical release rows | 0 |
| Backup / restore elapsed | 358 ms / 812 ms |
| Encrypted payload | 607232 bytes |
| CSV export / reparse evidence | 1 / 1; restored exactly |
| Read-only historical inspection | 1 record, 2 evaluations, 2 files; 0 issues |
| Original V1 tar + pre-P6 custom dump | Actual restore passed |
| Actual tool rejection cases | 12 passed |
| Focused archive/path/size regressions | 5 passed |

Actual rejections cover missing quiescence assertion; occupied file store/database; absent separate P6 archive root; wrong encryption key; ciphertext checksum corruption; linked source; authenticated link archive; V1 P6 coverage; omitted P6 artifacts; occupied non-public schema; linked destination ancestry. These failures preserve existing targets. Isolated failed restore stages are not reused.

One representative P6 event-history query was measured for twenty warm sequential reads: median 0.098 ms, p95 0.207 ms over ten event rows. EXPLAIN ANALYZE/BUFFERS is retained in ignored `report.json`; this small-fixture query and observed DR timings establish tooling evidence only, not expected hospital volume, sustained throughput or approved RPO/RTO. Existing stress/concurrency suites were not repeated for this task. Config/keys remain outside the archive and require separately governed escrow recovery.

Machine-readable `report.json` and `source-manifest.json` remain in the ignored drill directory. They record technical observations and hashes without keys/passwords. Partial source/target databases remain isolated for controller review; the dedicated cluster is stopped after task verification unless the controller coordinates further use.
