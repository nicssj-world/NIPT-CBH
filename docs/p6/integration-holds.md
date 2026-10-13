# P6 dependencies, decisions and AL-6 HOLD

## P5 interface reference

[PR #5](https://github.com/nicssj-world/NIPT-CBH/pull/5) was checked read-only twice on 2026-10-13. Exact latest head: `afa660a84217ec58279babd78fbf0426f62ad4d4`; base main `5d859c3a8be433b10668a9b097396cf1be69c54e`; open, draft, not merged. Local P5 source at this same SHA supplied interface details. No P5/Integration working file was edited or imported into P6 runtime.

| Interface needed by future P6 | PR #5 reference | Dependency / current P6 behavior |
| --- | --- | --- |
| Actual authorized active release | `result_release`: id, version_id, case_id, round_id, kind, state, certified_by, certified_at, **epoch** | `p5_release_authorized()` always false; insert/update blocked; no test release row created. P6 read port throws |
| Outbound channel authority | Only `channel='NIPT_ANC_VIEW'`; no HIS/CFS authorization | Do not reinterpret ANC-view release as outbound authority; Owner/clinical decision + integration contract required |
| Immutable report PDF/hash | `result_report_version.sha256` → `file_asset`; kind/template/parser/parsed values/version | Future adapter must read authorized immutable asset, verify hash and PIC. P6 uses synthetic byte buffers only |
| Round/attempt lineage | `result_report_version.case_id/round_id/attempt_id`, `analytical_attempt`, `specimen_round` | Future adapter validates current applicable round/attempt and approved report/release. No SQL/joins guessed in P6 |
| RG/RN clinical eligibility | `packages/results/gates.ts`, `service.ts` certification transaction; unresolved governance and P4b predicates | P4b QC4/QC5/analysis/FinalQcAccepted integration and AL-5 evidence required. Fixture flags cannot lift these gates |
| Original LN / generation / origin | P3/P4 lineage + `case_ln` verified-by-PET; historical forbidden | Must resolve existing integrated schema under approved lock order. Never use lab/HALOS LN as HIS LN; no new his_order for redraw |
| Epoch cancellation | P5 column is `epoch`, Plan prose uses cancel_epoch | Interface explicitly records actual column; no migration/rename. Future mapper must re-read under lock before OK and after OK |
| Certifier HIS identity | P5 certified_by is an application-user FK | Requires approved per-certifier HIS mapping, effective dates and missing-map failure. No legacy fallback identity |
| Round >=2 P[23] | Not resolved by P5 | No operational default. Pure fixtures require explicit CURRENT_ROUND/ORIGINAL_ORDER policy and matching source timestamp |
| Durable outbound tables/steps/confirmation/reconciliation | Plan logical tables differ from P1 simulator receipts and P5 release tables | Do not bind clinical outbound to simulator outbox/receipt. Integrated schema and migrations are deferred; no shared schema changes here |

`packages/p6/p5-interface.ts` is a structural reference, not release authorization. `heldReleasedResultReadPort` and `productionReleasedResultAdapter` always fail closed, including plausible released-looking candidates. Synthetic fixtures do not instantiate/persist P5 release rows. P6 has no route, worker handler, publisher, database connection or network/file transport.

## Owner / IT decisions still needed

| Decision | Existing requirement / owner | Pending evidence |
| --- | --- | --- |
| Q-I3: destinations and service identity | IT/HIS; single NIPT-owned workflow + editable paths already owner-confirmed | Approved host/mount/ACL, RES/CFS/backup paths, filename templates, temporary-name acceptance, rename/exclusive-create/durability semantics, service-account reconnect behavior |
| Q-I4: confirmation | IT/HIS | Real ACK, authorized read-only query or witnessed operator reconciliation; correlation rules, expected delay/timeout, operator evidence template and reconciliation closure procedure |
| Q-I5: versioned RES profile | IT/HIS | Sender/receiver/test/specimen/O[18]/suffix/ward/R[6], DOB/sex acceptance, escape interpretation, style and R[3] units/limit, actual certifier R[10] mapping |
| Q-I5: same-LN second result | IT/HIS | Second report after redraw/void, revisions/supersession/cancellation semantics; exact P[23] date source for round >=2 |
| OD-07 + AL-5: channels/PIC/templates | Owner / clinical governance / P5 | Which result/notice/revision may reach HIS/CFS; default notice is NIPT only; approved controlled templates/PIC and actual release authority |
| Backup policy | IT/HIS / retention owner | Per-transfer content/manifest, approved backup path, copy-before/after-delivery order, verification/durability, failed-backup handling, retention, restore and reconciliation procedure. Synthetic pre-OK proof is not this approval |
| Retry/recovery policy | IT/HIS / operations | Retry count/backoff/timeouts, collision waiting/admin handling, pre-/post-OK ambiguous failure, consumed-file retry/revision rules, no blind resend and no automatic delete |
| Real path test authorization | IT/HIS written procedure + clinical approver | Test patient supplied by HIS, exact names/times/observer, cleanup/rollback plan and approved Production outbound flag. No writes or probes in this delivery |

Do not re-question the confirmed single-application ownership or path configurability. Historical resend is outside P6 scope and stays prohibited; no EXT-HR/P5H work is introduced. Real path values from legacy material are not copied into configuration or this report.

## AL-6 remains HOLD

| Acceptance family | Evidence from this delivery | What remains |
| --- | --- | --- |
| AT-HISOUT-01/02 | Byte-exact **synthetic pure-source** oracle; all style/escape combinations, strict validation/length tests | Patient-bearing handover sample bytes intentionally not used; no direct sample replay or receiver acceptance claim |
| AT-RES-09 | Frozen synthetic PDF bytes/hash and model readback proof | Actual immutable P5 asset = web PDF = CFS byte equality with authorized integrated transport |
| AT-HISOUT-03 | Model step ordering/hash/failure/retry/backup/ambiguous OK checks | Real temp-write/sync/readback/rename/exclusive OK, failure injection at each actual I/O operation, durable journal |
| AT-HISOUT-04 / AT-LIN-11 | Snapshot N allocation/reuse, filename collision, original LN across synthetic rounds; no round >=2 default | Atomic reservation, true worker concurrency, actual same-LN second-result behavior/P[23] evidence |
| AT-HISOUT-05 | Pickup ≠ confirmed, timeout/reconciliation, synthetic correlated evidence only | Approved receiver evidence and operator workflow, durable record of who/when/what was observed |
| AT-CONC-03/04/05/07/08; AT-REV-05/06 | Deterministic epoch/consent/eligibility/config events at all model boundaries | Integrated DB lock-order/transactions, two real workers, revision/void/withdrawal races during actual writes, consumed-file ambiguity |
| AT-LDR-09 / AT-HIST-13 | Synthetic origin validation; historical origin rejected; production adapter closed | Authorized integrated publisher evidence, without creating historical exports or bypassing verified LN |
| AT-HISOUT-LAN-01 | **NOT RUN** | Signed IT/HIS LAN test: actual HIS state change, CFS opens exact PDF, and redraw second report using same original LN |

After Focused Integration Audit passes: refresh exact P4b/P5/integration SHAs and schema contract; obtain the remaining decisions; implement only the separately authorized P6 integrated adapter/schema/transport/settings/operations scope; prove clinical gating and durable concurrency using isolated synthetic integration; then perform the separately authorized signed LAN test. No merge, push, deployment, PR creation or real transport is authorized by this delivery.
