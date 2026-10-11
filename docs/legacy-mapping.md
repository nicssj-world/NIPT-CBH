# Verified legacy reference and P1 mapping

Read actual archives in memory, listing their entries before selecting source. Original archives and clinical documents were not modified or copied into this repository. No historical test result is represented as a newly executed test.

| Archive | Bytes | Entries | SHA256 |
| --- | ---: | ---: | --- |
| NIPTY_handover.zip | 5,483,650 | 606 | 332ef048b256ae81256238ce8d72abd4ebaf714e92e62797f45e4595cd2c4d9c |
| NIPTY.zip | 275,673,797 | 7,073 | ec54193058f43540180fe1b006d286a6a8bfa17b9d99580329fa9b164fae99e8 |

67 corresponding source/config/template paths compared by SHA256: 67 identical, zero differing/missing among that comparison set. This is narrower than claiming every archive entry matches. The large archive includes additional packaged/runtime/data material; the handover source is the implementation reference. Previous reports' 89-file comparison concerned a differently named handover archive and is not reused as this run's evidence.

Patient-like examples and sensitive configuration material were encountered. They were excluded from output and Git. New fixtures explicitly use SYNTHETIC names/identities and LN prefix 99000. Hermes prototype inspection found placeholders, a TypeScript/SQL HIS-order policy mismatch and incomplete lineage constraints; it was not copied.

| Legacy source / behavior | New module | Preserved / bounded change |
| --- | --- | --- |
| services/pet_parser.py | packages/integrations/pet.ts | CP874, pipe/caret, first matching test 70096, positional P/O fields, LN zeros preserved; reject structural injection, invalid dates and non-synthetic input |
| services/pet_scanner.py | packages/integrations/scanner.ts | YYYYMMDD lookback, section7, same-stem OK readiness, no source deletion; content hashes and S1 integrity events added |
| services/res_generator.py | packages/integrations/res.ts | UTF-16LE BOM, H/P/O/R/L field widths, CR separators, escaping, LN+hour+last-minute-digit filename |
| services/result_text.py | packages/integrations/res.ts | Ordered trisomy/SCA text; full/short/fixed style; legacy permissive strings stay serializer compatibility, never clinical eligibility |
| services/pdf_exporter.py | packages/integrations/publish.ts | Original PDF bytes, attempt_HN__LN filename, no rerender of result PDF; immutable staging/hash checks added |
| Legacy file transfer/export | packages/integrations/publish.ts | Verify PDF and RES before OK; exclusive collision detection, retry idempotency, cancellation epoch/reconciliation; simulator only |
| Legacy scheduler/retry/log | packages/jobs/worker.ts | One own Node worker, pg-boss/outbox, safe coded logs, heartbeat and bounded retry |
| Legacy backup settings | deploy/scripts/backup.mjs and restore.mjs | Encrypted DB/file backup tooling; no per-result backup/ACK guarantee invented from old source |
| New controlled PDF foundation | apps/renderer, packages/pdf | Isolated Chromium with local Thai font; session-bound immutable preview bytes |

The source actually writes an empty UTF-16 OK text file with BOM, so the simulator uses `fffe` sentinel bytes. RES prose refers to HL7, but executable records are H/P/O/R/L; no MSH/PID redesign is introduced. The legacy filename's minute-digit collision is preserved as a compatibility constraint and detected, rather than silently changing the receiver protocol.

The inspected export path allows partial RES/PDF success and does not establish atomic publish, hash verification, receiver ACK, certification/manual-review gates or per-result backup. P1 adds the Plan's safety controls in synthetic adapters. Real mount/receiver compatibility and acknowledgement, original operator identity, round2 result specimen-date policy and clinical PDF PIC remain AL-3/AL-5/AL-6 evidence work.
