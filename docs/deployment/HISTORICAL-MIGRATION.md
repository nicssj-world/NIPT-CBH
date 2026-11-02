# Historical migration into Production (owner authorisation 2026-11-02)

One-time import of the Genomic-CBH history into the installed Production, using the migration services of the candidate
`feat/codex-migration-20261026` ported onto v1.1.2 (migrations renumbered 162-175; the services, routes and tests are the candidate's).
No migration tool, GUI or EXE is used. A small operator runner (`tools/migration/run-production-migration.ts`) calls the same services in
explicit phases; it is started with `nipt-admin ops-run` from the **installed release**, so the code that executes is the code that was deployed.

## What is imported, and what is not

| Source | Used for |
|---|---|
| LN mapping workbook (SHA-256 pinned by the owner) | LN / LN Halos pairs, kept exactly as issued |
| HALOS Run001, Run002, Run003 workbooks | analytical results per attempt; repeats stay in their lineage |
| PET files from the HIS inbound folder (read only, selected by file name) | patient identity, sending ward -> case, round, attempt, original LN Halos |
| Final-report PDFs (read only) | linked **only** when the printed sample ID with its attempt suffix and the HN select exactly one current qualified attempt, and the file name and printed name agree with the PET patient |

Never done by the import: QC, pooling, consent or laboratory events that have no evidence; certification or release of any result; any HIS
transmission; a new Run (the batch sequence is set so the next Run is Run004/2026).

## Safeguards (all re-checked before and after every phase; the runner stops on the first failure)

1. Environment is `production` / `operational` and the database carries the Production marker.
2. A **signed receipt of a verified backup** for this exact database, not older than 24 hours (published by the service identity's scheduled backup).
3. HIS outbound is not enabled; `p6_transfer` and `result_release` are empty before and after.
4. The mapping file must match the SHA-256 the owner attested.
5. Records whose "PDF already in HIS" flag is unconfirmed are acknowledged explicitly; with outbound disabled and nothing released, nothing can be sent.
6. A case marked "PDF already in HIS" never creates a transfer (database function `task3_his_presence_attested`).
7. Allocator gate (migration 167/175): once an execution exists, new LN Halos numbers are refused (`ALLOCATOR_HANDOVER_PENDING`) until an allocator
   handover with **read-only Genomic-CBH evidence** is applied. Already-reserved original numbers are unaffected.

## Phases (idempotent; counts only in the output)

`preflight` -> `units` (the sending unit is the ward printed on the PET itself) -> `execute` (staging records, analyses, historical runs, PET binding)
-> `pdfs` (batches of 20) -> `report`.

## Recovery

Restore from the verified backup taken immediately before the import (isolated restore into a new database, then activation with the source fenced).
Anything written after that backup is lost on restore.

## Open items are recorded in the release checklist.

## Remediation after the first Production import (Owner decisions, 2026-11-02)

Applied on the installed Production with the same runner (`nipt-admin ops-run`), as idempotent phases; nothing is re-imported or reset.

| Phase | What it does | Never does |
|---|---|---|
| `execute` (with the updated mapping, `--pet-received-at <time>`) | adds the November delta rows (no case, no analysis without evidence); binds the PET whose duplicate differs only in receipt time, keeping the receipt time the Owner named | pick a PET by any rule of its own; touch the other 201 cases |
| `twin` | attaches a twin `<LN Halos>D-<n>` analysis imported before the parser knew the D form to its existing case and bare first attempt (`migration_repair_twin_attachments`, migration 177), audited, idempotent | create a case, attempt or analysis; weaken the immutability guards (they still refuse every other change) |
| `paper` | sets request and consent to Paper for the workspaces of migrated cases; new workspaces of migrated cases start as Paper | create a document, signature or approval |
| `pdfs` | links a PDF when the printed sample ID + HN select exactly one current qualified attempt; a matching LN (file name) or HN is the identifier, a name difference is kept as evidence and never rejects; an LN in the file name pointing elsewhere is a conflict | link by name alone; release or certify |
| `handover --expect-last <LN Halos>` | LN Halos allocator hand-over from the Owner-confirmed Excel mapping (`OWNER_CONFIRMED_EXCEL_MAPPING`, migration 176): per-month high-water, the next number is last+1, a new month starts at 001 | read the Genomic-CBH database; carry one month's counter into another |

The ANC dashboard shows "มีผลแล้ว (ข้อมูลย้อนหลัง)" beside a migrated case whose official PDF is linked. It is a separate fact: stages, KPIs, certification and HIS transfers are unchanged.
