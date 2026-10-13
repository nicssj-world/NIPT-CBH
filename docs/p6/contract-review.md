# P6 HIS outbound / CFS contract review

Authority: Owner's P6 parallel development order and subsequent STRICT SCOPE LOCK (2026-10-13); Implementation Plan v6.2.1. P6 uses `feat/p6-outbound-contract-synthetic` at `D:/Claude workspace/NIPT-CBH-P6`, based on remote main `5d859c3a8be433b10668a9b097396cf1be69c54e`. Main was not moved. P4b, P5 and Integration worktrees are read-only references. No migration, shared source, database, route, settings catalog, worker registration or clinical gate is changed.

## Evidence and method

Originals were read in place in the immutable NIPT-Audit source directory. ZIP central directories were inventoried before selective source reads. No patient PDF/PET/RES/sample payload, runtime database, credential configuration or operational log was loaded. No legacy app, Flask route, copier, writer, scheduler or maintenance command ran.

| Original | Bytes / entries | Verified SHA-256 |
| --- | --- | --- |
| Implementation Plan v6.2.1, reviewed 2026-10-11 | 1,186,202 bytes | `261acf8cebec7915d255abaccf02e2bb55d76de0a59b26d9c7abc7b0c7703c2e` |
| NIPTY.zip | 275,673,797 bytes / 7,073 entries | `ec54193058f43540180fe1b006d286a6a8bfa17b9d99580329fa9b164fae99e8` |
| NIPTY_handover.zip | 5,483,650 bytes / 606 entries | `332ef048b256ae81256238ce8d72abd4ebaf714e92e62797f45e4595cd2c4d9c` |

The four source members below were byte-identical between `NIPTY/app/` and `NIPTY_handover/source/app/`. This finding applies to these members, not every ZIP entry.

| Relative source | SHA-256 | Relevant lines |
| --- | --- | --- |
| `services/res_generator.py` | `cdef6943:92003270:6e36a55d:0a5cd143:3ec61551:1e3f0cb0:e94a6275:d6e8efe4` | 43–50 constants; 66–88 escape; 99–179 dates/names/filename; 186–303 records; 310–341 writer |
| `services/result_text.py` | `629b433e980495d21fda93fec86a4f6c53b3fc4fc8b301d373f27dd2d9f5ad91` | 32–63 ordering/join/trim; 66–134 styles and fallback |
| `services/pdf_exporter.py` | `f44655e129aec274f0a4cd20943caf8177ac3657f8eac38b22cb2c8629980ebd` | 27–82 sanitization/templates; 89–143 copy; 150–190 bulk |
| `routes/export_routes.py` | `99b8c60765b6b202e6ddfb02bb64c777224073d4a654f8ab49c5f730c330d131` | 29–94 single/bulk/history; 114–133 history deletion on rematch; 140–262 selection/export/audit |

`tools/p6/legacy-goldens.py` verifies both archive hashes and all four source hashes, then executes only allowlisted pure AST definitions from the three service members. It excludes application imports, file-writing/copy functions, wall-clock fallback and original operator identity. Every call supplies synthetic data, fixed timestamps and `SYNTHETIC^SYNTHETIC`. Generated JSON contains 492 independent legacy RES expectations and seven PDF naming expectations. Empty UTF-16 `.ok` is checked using an in-memory Python text stream; no `.ok` file is written.

Source/fixture SHA-256 values may be grouped into eight-character blocks with colons; remove colons for standard hex comparison. This avoids numeric digest substrings triggering the unchanged national-ID source guard; no source bytes or digest values change.

Coverage: three styles × (12 edge scenarios × three name/date variants + 128 trisomy/SCA combinations) = 492 RES fixtures. The 128 combinations are all eight trisomy high/low combinations × all 16 SCA detected/not-detected combinations. Edge cases include null/empty/partial reports, redraw notices, trim handling, Thai, all delimiters, leading zeros, blank specimen date, whitespace-only CFS text and Buddhist-era date conversion. The broad style table is a serialization oracle, not clinical interpretation or release eligibility.

## Legacy wire contract

Five records `H/P/O/R/L`, widths `14/35/26/12/3` including record identifier at index 0. UTF-16 little-endian with BOM `ff fe`; CR `0d 00` between records and after L. No LF. Escaping order: backslash → `\E\`, pipe → `\F\`, caret → `\S\`, tilde → `\R\`, ampersand → `\T\`. This is the existing record protocol; the prose label HL7 is not authority to substitute MSH/PID records.

| Record fields (zero based) | Legacy behavior | P6 contract treatment |
| --- | --- | --- |
| H[1], H[4], H[9], H[11], H[13] | `\^&`, configurable sender/receiver, processing `P`, generated timestamp | Same structure; explicit frozen synthetic profile/version/time |
| P[2], P[3], P[5], P[7], P[8] | Original LN, HN, parsed `surname^^prefix firstname`, DOB, sex | Synthetic identity only; delimiter escaping, dates and encoding validated. Receiver acceptance of DOB/sex remains Q-I5 |
| P[21], P[23] | LN repeated; specimen timestamp pair, or `^` when empty | Legacy serializer parity retained. Transfer freeze requires specimen evidence. Round >=2 has no policy default |
| P[24], P[25], P[27], P[33], P[34] | `R`, ward ID/name, `^O`, `0^ward`, `^99` | Same positions; ward profile configurable, no hospital path/identity defaults |
| O[4], O[15], O[18], O[25] | `^^^testcode^B^0`, specimen code, configurable field18, `F` | Versioned synthetic profile; semantics Q-I5 |
| R[2], R[3], R[6], R[8] | Test code; escaped composed text; flag `A`; final status `F` | Same wording/order for recognized synthetic values. Flag configurable per Plan; actual profile needs approval |
| R[9], R[10], R[11] | Approval pair; configured operator (legacy has hardcoded fallback); original LN + suffix | Serializer accepts explicit synthetic certifier only; real certifier HIS mapping is a dependency, not the legacy operator fallback |
| L | `L|1|N` | Exact parity |

RES filename: `{original LN}{HH}{last minute digit}.res`; readiness name is same stem plus `.ok`; outbound `.ok` contains only `ff fe`. This causes deterministic collisions within a repeated hour/minute-digit slot, including different days. Preserve the protocol; reject collision rather than append an invented suffix or overwrite. Filename generation uses the frozen explicit local wall timestamp, never the execution host's clock.

PDF name defaults to `N_HN__LN.pdf`. Legacy replaces an initial N or numeric prefix with the export count, then substitutes HN/LN and sanitizes unsafe filesystem characters in identity components. The P6 pure naming reference preserves safe configurable templates, including `N`, `HN`, `LN`, custom literal prefixes and numeric prefixes. Templates without LN/N are compatibility references only; receiver acceptance and collision risk remain Q-I3. Path separators, control characters and embedded extensions are rejected as new safety validation; no real naming policy is activated.

## Legacy behavior versus required new controls

The route selects the latest non-redraw result by reported date/import time/id, falling back to the latest redraw notice. It has no certified-release gate. It counts **all export rows, including failures**, to obtain N. A single wall-clock value populates both H[13] and R[9]. It writes RES and `.ok` first, then independently copies PDF with `copy2`. RES/PDF errors and flags are stored separately; combined success requires both. Single and bulk calls share this route logic. There is no safe atomic cross-destination transaction or proof of receiver import. Rematch deletes export history; that is not compatible with the Plan's immutable audit and must not be ported.

The new Plan §10.3–10.6 requires released-only payloads, original LN across redraw, export identity `(LN, LN generation)`, frozen report version/round/attempt/hash/profile/epoch, lock/unique reservation, PDF verification before RES verification before exclusive `.ok`, authorization/consent/epoch rechecks, no overwrite, idempotent retries of the same transfer, durable logs, backup and evidence-based confirmation/reconciliation. A new release/revision uses the next N; retry reuses the frozen transfer/N and does not recertify. These controls intentionally replace legacy unsafe transport behavior; they do not remove single/bulk/history/naming capabilities.

Source `app/app.py:30–35` configures UTF-8 rotating application logs (5 MB × five backups). This is log rotation, not per-transfer backup. The inspected outbound functions do not implement receiver ACK, automatic retry/backoff, durable reconciliation or verified per-result backup. Inbound scheduler defaults must not be repurposed as outbound defaults. Owner clarification confirms a single NIPT-owned outbound system and editable paths; exact backup transport, ordering/retention, retry intervals and receiver evidence require IT decisions.

## Scope and implementation rulings

- Additive P6-only files; reuse existing pure wire/date validators read-only. Do not fix findings in P1/P5 or modify shared imports/catalog/worker/migrations.
- Pure RES serialization remains separate from transfer eligibility. Null/partial/redraw fixtures exercise legacy wording; they confer no clinical authority. Unrecognized result strings fail validation instead of inheriting legacy's nonempty-value low-risk fallback.
- Whitespace-only CFS text preserves legacy's empty-text behavior in the pure oracle; transfer freeze rejects blank CFS text. Notice types must be canonical, and transfer HOLD also checks trimmed notice type. Selected round >=2 date evidence must be canonical 14-digit local timestamp; timezone/trailing suffixes are rejected rather than discarded.
- `fixed` is the starting profile style per D-23; full/short remain available for fixture parity. `4096` escaped UTF-16 code units is a synthetic bound only, not an approved receiver limit. No truncation. Q-I5 must define actual units/limit.
- Pure transfer events require PDF + RES + backup hash proofs before an OK observation. Backup-before-OK is a conservative **synthetic test sequence**, not an Owner/IT backup-policy decision. No production order/default is installed.
- Only `simulator/p6/...` lexical path candidates are accepted in P6 fixtures. Validation does not prove canonical paths, symlink containment, ACLs, mount behavior or write access; no connection test is performed.
- Reservation decisions use an immutable supplied snapshot. They are not a concurrent DB reservation; actual advisory lock, unique constraints and two-worker proof await integration.
- P5 read port and production adapter always throw `P6_INTEGRATION_HOLD_P5_AL5_AL6`, regardless of candidate data. No runtime calls either function; no publisher exists in P6.

The AL-1 Lock/Consolidated Owner Decision supersede stale Plan/clarification “proposed/AL-1 not ready” wording: D-23, D-28 and D-30 are accepted engineering choices, D-31 is owner-aligned, while D-08 remains a downstream evidence gate. AL-6 is not passed. No clinical or LAN acceptance follows from these choices.
