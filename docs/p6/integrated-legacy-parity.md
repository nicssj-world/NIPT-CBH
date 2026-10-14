# Integrated synthetic P6 legacy parity expansion

Extends every capability in [the original matrix](legacy-parity-matrix.md), preserving both ZIP references/source evidence. No legacy patient sample was reread or redistributed. The 492 RES / seven naming oracle expectations remain byte-for-byte unchanged from adc64e1.

| Legacy / Plan capability | Integrated evidence | Actual status |
| --- | --- | --- |
| H/P/O/R/L, BOM, CR, escaping, all R[3] styles | Preserved 492 goldens and strict pure tests; frozen bytes read back natively | IMPLEMENTED SYNTHETIC; actual receiver profile/style/length HOLD Q-I5 |
| Configurable profile/DOB/sex/operator/ward/dates | Pure versioned contract frozen in fixture/journal, no real certifier fallback | IMPLEMENTED SYNTHETIC; R[10]/field semantics/PIC HOLD |
| RES minute-digit name / same-stem BOM-only OK | Exclusive sandbox publication/readback; collisions reject, no random rename | IMPLEMENTED SYNTHETIC; receiver naming/filesystem HOLD Q-I3 |
| PDF names/templates/original bytes | Seven naming goldens; native inode/bytes stable after recovery; backup hash verified | IMPLEMENTED SYNTHETIC; actual released asset/web/CFS parity HOLD AL-5/6 |
| PDF copy/rename and partial RES/PDF success | Fsynced local staging, exclusive no-overwrite publish; PDF→RES→backup→OK; 20 failure cases | SAFE SYNTHETIC REPLACEMENT; hospital rename/durability not inferred |
| Original LN across redraw/revisions, N/history | Native atomic/unique reservation; 12-client concurrency; same retry N; pure round >=2 explicit policy | IMPLEMENTED SYNTHETIC; actual second-result/P[23] HOLD Q-I5 |
| Single/bulk export | Per-fixture reservation and worker cycle drains multiple fixtures; CLI full workflow | SYNTHETIC QUEUE IMPLEMENTED; clinical single/bulk UI/released-only orchestration HOLD, not removed |
| Latest result/notice selection | No raw P5 selection by HN/LN/date; actual authority boundary held | CLINICAL SELECTION HOLD; notice channel blocked OD-07 |
| History/flags/log/audit | Durable steps/immutable evidence, coded audit chain, status/heartbeat CLI | IMPLEMENTED SYNTHETIC; hospital UI/real receiver records deferred |
| Rematch deletes history | No final/transfer/history deletion; append-only revision/evidence | UNSAFE LEGACY MUTATION NOT PORTED; Plan audit preserved |
| Retry/backoff/recovery | Durable attempts/deadlines/checkpoints, same bytes/N, admin ceiling; abrupt process crashes on four artifacts | IMPLEMENTED SYNTHETIC; consumed-file/backup/revision policies HOLD IT |
| Duplicate prevention/competing workers | Native transaction/session locks, DB/file uniqueness, exact replay, no expiring active-writer lease | IMPLEMENTED SYNTHETIC; clinical P5 lifecycle lock integration HOLD |
| Withdrawal/void/supersede/config race | Synthetic gate events; final OK rowlock fence; before OK prevents file; after OK/confirmation reconciles | IMPLEMENTED SYNTHETIC CONTROLS; no P5 consent/gate mutation |
| Backup versus log rotation | Per-transfer PDF/RES/manifest before OK; coded logs and immutable copies | IMPLEMENTED SYNTHETIC; real order/topology/retention/restore HOLD |
| Pickup/confirmation/reconciliation | Native simulated pickup unconfirmed; timeout unknown; correlated synthetic evidence/investigation; no auto resend/delete | IMPLEMENTED SYNTHETIC; actual HIS ACK/status/CFS opening NOT TESTED |
| Path configuration | Version/hash/schema; fixed root; alias/reparse/hardlink/traversal checks | IMPLEMENTED SYNTHETIC; live settings/maker-checker/ACL HOLD |
| LAB_DIRECT/HISTORICAL | ANC/LAB_DIRECT fixtures, historical rejected, no clinical adapter fallback | IMPLEMENTED SYNTHETIC; verified-PET/clinical lineage HOLD; P5H untouched |

No clinical capability is marked implemented because a synthetic substitute works. AT-HISOUT-LAN-01 NOT RUN; AL-5/AL-6 HOLD. Playwright covers CLI workflow, with no new browser UI.

## HIS Settings integration follow-up (2026-10-14)

[HIS Settings functional integration](../his-settings-integration.md) adds active, version-bound paths, Worker connection tests and Settings history/retry with the existing P6 journal/transport. Earlier fixed-sandbox wording describes the original delivery. Hospital LAN/UNC acceptance remains NOT RUN; AL-5/6 and clinical publication stay HOLD.
