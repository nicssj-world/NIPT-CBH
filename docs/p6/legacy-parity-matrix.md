# P6 legacy parity matrix

Both original ZIPs are the immutable baseline; source identities and exact audit method are in [contract-review.md](contract-review.md). Status is scoped to this delivery. A pure model test is not transport/receiver proof. No existing capability is deleted; deferred capabilities remain explicitly assigned to P6 integration.

| Capability / source evidence | P6 implementation and evidence | Status / remaining gate |
| --- | --- | --- |
| H/P/O/R/L layout, BOM, UTF-16LE, CR (`res_generator:186–303,328–329`) | `packages/p6/res.ts`; 492 byte-exact synthetic Python-oracle fixtures; malformed BOM/surrogate/separator/field/profile tests | PURE CONTRACT COMPLETE; patient-bearing sample bytes not read; receiver parity HOLD |
| Ordered escaping (`res_generator:66–88`) | Golden delimiter/Thai cases + 100 property runs with delimiters/Thai/emoji | PURE CONTRACT COMPLETE; receiver escape interpretation Q-I5 |
| R[3] full/short/fixed, 45,X, redraw, missing/partial (`result_text:66–134`) | 492 golden table; every trisomy/SCA combination; trim handling | PURE CONTRACT COMPLETE; notice transfer HOLD OD-07; style/limit Q-I5 |
| R[3] maximum length | Explicit synthetic escaped UTF-16 code-unit bound; exact-boundary/overflow tests, never truncate | NEW VALIDATION; receiver units/maximum HOLD Q-I5 |
| Sender/receiver/test/specimen/field18/suffix/ward (`res_generator:223–239`) | Versioned synthetic profile; custom-position tests | PURE CONTRACT COMPLETE; production semantics/mapping Q-I5 |
| Result flag/status/operator (`res_generator:287–291`) | Result flag profile; final status F retained; explicit synthetic R[10] | PURE CONTRACT COMPLETE; certifier HIS mapping and actual profile HOLD |
| DOB/sex/name/date normalization (`res_generator:99–163,246–264`) | Golden Thai prefix/blank specimen/Buddhist dates/leading zeros; invalid date/surrogate rejection | PURE CONTRACT COMPLETE; DOB/sex receiver acceptance Q-I5 |
| RES name LN+HH+last-minute-digit (`res_generator:170–179`) | Exact golden names; cross-day/slot collision preserved and detected; no random suffix | PURE CONTRACT COMPLETE; real exclusive write/replay behavior HOLD |
| `.res/.ok` same stem, outbound `.ok` BOM (`res_generator:310–341`) | Oracle in-memory Python empty UTF-16 stream + byte assertion; modeled OK hash proof | PURE CONTRACT COMPLETE; no sentinel files generated/published |
| PDF naming/sanitization/templates (`pdf_exporter:27–82`) | Seven additional oracle expectations; canonical/numeric/custom/N/HN/LN templates; unsafe identity chars sanitized | PURE CONTRACT COMPLETE for safe templates; path/control/embedded-extension templates rejected, actual naming Q-I3 |
| Preserve PDF bytes; copy/rename (`pdf_exporter:89–143`) | Frozen original synthetic bytes/hash; no rerender; pure PDF verification step | CONTRACT ONLY; actual staging/sync/readback/exclusive rename/PIC integration pending |
| Single and bulk export (`export_routes:29–76`, `pdf_exporter:150–190`) | Per-transfer contract is reusable by future single/bulk orchestration | DEFERRED P6 integration; no UI/endpoint/queue introduced |
| Latest report/notice selection (`export_routes:151–185`) | No legacy auto-selection ported; closed released-result read boundary | DEFERRED P5 integration + OD-07; reviewed active release mandatory |
| N count including failures (`export_routes:189–196`) | Immutable snapshot reservation; original LN/generation across rounds; revision N+1, same frozen retry N | NEW PLAN SEMANTICS; durable reservation/locking pending |
| RES before PDF; partial success (`export_routes:203–234`) | Pure sequence PDF → RES → backup → OK → post-OK check; invalid transition/hash/failure injection tests | LEGACY UNSAFE ORDER REPLACED BY PLAN; real transport pending |
| Separate RES/PDF flags and errors/history/audit (`export_routes:217–248`) | Separate step states, coded immutable in-memory logs, frozen hashes, no PHI/error messages in logs | CONTRACT ONLY; durable journal/history/operations UI pending |
| Rematch removes export history (`export_routes:114–133`) | No deletion action exists in P6 model; retain history on retry/revision/cancel | LEGACY UNSAFE MUTATION NOT PORTED; immutable integration history required |
| Retry/backoff | No outbound policy found in inspected functions; explicit fixture retry schedule, exact backoff, capped failures, no recertification | NEW PLAN CONTROL; no legacy three-attempt assumption, production policy IT review |
| Duplicate prevention | Frozen retry reuse; changed payload rejection; actual destination identity collision despite settings-version changes | PURE SNAPSHOT MODEL COMPLETE; DB concurrency/exclusive filesystem operations not implemented |
| Cancellation/withdrawal/void/revision | Epoch/eligibility/consent/config recheck at each model boundary; before/after OK distinction; partial artifacts reconciled | PURE MODEL COMPLETE; real lock/transaction/worker races pending |
| Backup / application log rotation (`app.py:30–35`) | Synthetic per-transfer PDF/RES backup proofs; failure prevents OK observation | NEW CONTROL MODEL; real backup topology/durability/order/retention pending IT, log rotation is not backup |
| Pickup/ACK/confirmation/reconciliation | Pickup unconfirmed; timeout unknown; correlated synthetic ACK/operator/query evidence; ambiguous OK requires reconciliation | PURE MODEL COMPLETE; no authoritative receiver evidence, method Q-I4 |
| Path settings (`path_resoutput`, `path_pdfrename`, `pdf_template`, `hl7_*`) | Pure lexical synthetic-path validation/version/hash; preserve configurable wire/naming contracts | CONTRACT ONLY; existing settings catalog unchanged; maker-checker UI/mount/ACL/last-good integration pending |
| LAB_DIRECT / HISTORICAL | ANC/LAB_DIRECT fixtures allowed; historical/unknown origins rejected; no adapter can release/send | NEW LOCKED PLAN SAFETY; actual verified LN/origin lineage dependency pending |

P1/P5 findings remain outside this diff: P1 `resultText` does not trim SCA values as legacy does; P1 publisher is a simulator, not the full P6 safe-publish/backup/confirmation implementation; P5 only supports `NIPT_ANC_VIEW` and prohibits release rows. They were not modified. P5's unrelated A19/A21/A22 gaps stay with their assigned phases.
