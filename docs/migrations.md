# Migration checksums

SHA-256 of canonical committed LF source. Applied only to disposable synthetic/test databases; never Production. The migrator verifies immutable applied history before forward application.

| Migration | SHA-256 |
| --- | --- |
| 001_foundation.sql | `5d013f4ecd13424373059fb33827ba4cda265b929014a991efee2d0683f18492` |
| 002_security_settings.sql | `4965ec3b918df8769b78cd41696b7c5439b00e8ba77dcb15afa4cbbfc3e5fe6c` |
| 003_web_foundation.sql | `8f47ab63924d1138d457171ce7025632e8041a9d99c4f26f6b9828b456b13b99` |
| 004_integration.sql | `96e1e3c32e6e029bb38ff9dc92194103cdd5735fe0155b4a4aad85fb6fa2aa07` |
| 005_phi_access.sql | `61df4b863c9016b2808276240a6e4c36af71c65ced38b35641199ba82c9c9274` |
| 006_p2_synthetic.sql | `fc48d19774f0f9517db7f271d1d93bcd96493c82a1510a238e8550c4245c5107` |
| 007_p2_consent_document_uniqueness.sql | `51cda447ae029673c920a96234fcbdae430b3b115e84dcdbceb14d00dd5fa1d1` |
| 008_p3_his_inbound.sql | `666c7ebed7839479ba52b40d76080502a03fb34c2bdb5ddc088f15124b4a25cf` |
| 009_p2_p3_registration_identifier_source.sql | `aa98a4723624a2902bd9e28cc223e72dcbc9dac9a2dc5c553ccde0eaaea5a79a` |
| 010_p4_lab_workflow.sql | `0fa7255c0ed7c374fc2353787ac00c32aee29f4199229069109159c3d7762670` |
| 011_p4b_pooling_synthetic.sql | `045c74c3b2cfdf96a81fe573f44a6b05cf8e0097dfa1e0344b931d49c1738429` |
| 012_p4b_pool_cancellation_guard.sql | `5de51c725d72c21955eef327730fa9bcc35bea7f7d36839199b8607a29f9bb00` |
| 013_p4b_system_invalidation_actor.sql | `14ab594dea4d71c82c941a03a41ce9790c261e078f905bb23fbc59e13b47306a` |
| 014_p4c_dnb_sequencing_handoff.sql | `b43654139a1422903428e8d693723e8e5563aad09a68b44ae75c750ede8000e8` |
| 015_p4c_f5_documents.sql | `9fbffa44b8f8d9e68fe68db24b0e0bb9ff3fa06b9fc17a783a9d7e845193f601` |
| 016_p4c_evidence_gates.sql | `70d802b3f05e26785e1f6e116234bbdf716c7b136370f6982f1f31f206a8dea1` |
| 017_p4c_plan_metadata.sql | `378d038163a52a01a141801cae5e3bb5896b28de6b4146636978c923364e798a` |
| 018_p4c_current_preview.sql | `6b3c2cce5d0cc074e717284053bf890a074bb5e7fe6aee5371592baac1f1fcb8` |
| 050_p5_result_management_synthetic.sql | `a90b9cbf8270c7d7c6a08019a4a7ebd5cb4dc227f44dcce5df2aecd1e6f4d092` |
| 051_p5_name_conflict_review.sql | `4f39cd4accca0c04fcb9071c6e709acf663f3cc194c39505617a4719dd4b9570` |

Migration006 adds restricted synthetic P2 identity/draft/revision/paper/signing/doctor/PDF-access/withdrawal evidence and guards. Applied only to disposable local synthetic databases using the ordinary checksum-enforcing migrator; no Production apply. Migration001–005 source bytes remain unchanged. Subsequent fixes use a new forward migration.

Migration007 enforces one active signing attempt, signature and final Consent per immutable document revision, and validates exact source evidence plus the declared canonical hash algorithm. It refuses existing ambiguous evidence rather than deleting or selecting a winner. Existing migration006 payloads/hashes remain unchanged; new final rows use `PG_JSONB_CANONICAL_V1`. Only isolated synthetic/test databases are migration targets.

Migration008 is the P3 synthetic HIS inbound schema, authored on the parallel P3 branch as `090_p3_his_inbound.sql` (SHA-256 `acd225953a7cce8e4a084ee6db06eb99a211ff7c770dde3392b040e243bbbadf`) and renumbered at P2–P3 integration to the next free slot after 007. Only its second header comment line changed; the SQL body is byte-identical. No database ledger was edited: earlier disposable P3 databases that applied 090 are discarded, never relabelled. Migration009 adds the nullable, value-checked `registration_attempt.identifier_source` for blind entry. The P3 runtime grants formerly in `roles-p3.sql` are merged into `packages/db/roles.sql`, with column-scoped worker reads of `p2_case_identity(case_id,hn)` and `p2_collection_fact`. Ordered 001–009 application and ledger checksums were verified on fresh disposable databases; see [p2-p3-integration-review.md](p2-p3-integration-review.md).

Migration010 is the additive P4 synthetic Lab workflow schema: receipt-bound LN Halos issuance (`specimen_lab_number`, daily sequence 001–999 per Asia/Bangkok day, SECURITY DEFINER receipt trigger that also creates attempt #1 — neither `app_rw` nor `worker_rw` can insert or alter a lab number), the full §5.6 attempt state set with a transition guard and immutable Printed Sample ID, Repeat/Redraw lineage columns, append-only attempt events, Batch/Task List template (RunNNN/YYYY, 48 slots, PC1/NC25/Blank40), one live slot per attempt, Placement snapshots, Issued originals and derivatives, insert-only observations with second-person review, slot dispositions, unapproved QC1 criteria versions with human Stage QC1 decisions, and label print jobs. The issuer takes the audit-chain advisory lock (75432801) before the sequence row so it can never deadlock against audit appends (found by the native P3 smoke). Existing rows are not back-filled; rounds received before 010 obtain their number only through the audited `RECEIPT_RECOVERY` path. Ordered 001–010 application was verified on fresh disposable PGlite and PostgreSQL 17 databases; see [p4-synthetic-delivery.md](p4-synthetic-delivery.md).

Migrations014–018 add DNB/QC3, sequencing/QC4, handoff verification and F5 simulation evidence. 016/017 close direct-INSERT lifecycle, NULL verification, plan-cell/template and lock gaps; 018 gives F5 previews a SQL-derived current-evidence stamp. No earlier committed migration changed. Final checks use fresh disposable loopback native/browser databases with canonical LF source and complete queue/role preparation. Earlier disposable development targets were preserved; no ledger was repaired. Before first commit, 016 line endings were canonicalized from a mixed CRLF/LF development file without SQL changes; the final fresh-target ledger hashes above are authoritative. P5 reserves050 independently; do not apply011–018 behind an already applied050 ledger. See p4b-p5-integration-contract.md.

Migration050 is the additive P5 restricted synthetic Result Management schema. It was authored in a **reserved P5 band (050+)** because P4b on `feat/p4b-halos-export-contract` already uses 011–013 and will add DNB/Sequencing migrations next. Lexical ordering keeps 050 after any P4b number below 050, so the branches cannot collide. Following the P3 precedent (090 → 008), it is renumbered to the next free slot at integration only if the integration review requires it, and no applied ledger is edited. It adds the quarantined intake, report versions with a DB transition guard, append-only version/link events (DB-enforced second person for link approval), RG/RN gate evaluations with idempotency keys, review attestations, an access log and a release table. `p5_release_authorized()` returns `false`, so no `CertifiedReleased` state or release row can exist until a reviewed migration after AL-5. 001–010 are byte-identical to main. Ordered 001–010 + 050 application was verified on fresh disposable PGlite and PostgreSQL 17 databases; see [p5-result-management-delivery.md](p5-result-management-delivery.md).

Migration051 implements Owner decision A14. It adds `result_link_event.name_review` (NEW_REPORT/REVISION) with consistency checks against `revision`, and an index on the intake display name. It replaces `p5_link_event_guard()` so that a second-person approval must repeat the proposer's classification. The function is replaced by a new forward migration; 050 is byte-identical. Ordered 001–010 + 050 + 051 application was verified on fresh disposable PGlite and PostgreSQL 17 databases.
