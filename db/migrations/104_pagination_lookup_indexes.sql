-- Lookup indexes for the paginated Lab worklist, ANC dashboard and registry (forward only, additive; no table, column or row changes).
--
-- Evidence (EXPLAIN ANALYZE of the shared per-attempt / per-case facts queries, packages/lab/core.ts attemptFacts and
-- packages/anc/service.ts factsSql, on a synthetic database with 5,000 cases, 2026-10-19): every table below is read by a correlated
-- sub-select keyed on round_id, and without an index the plan runs "Seq Scan ... loops=4997" for each of them, so the cost grows with
-- the SQUARE of the attempt count. With only the first two indexes the full worklist read fell from 13.8 s to 0.5 s.
-- Indexes are created only where such a scan was measured; tables that already have a matching index (result_release partial unique,
-- p2_document_revision unique, lab_slot_assignment partial, analytical_attempt unique) and tiny tables (p2_revocation) are left alone.
CREATE INDEX IF NOT EXISTS p2_paper_review_round_kind ON p2_paper_review(round_id,kind,created_at DESC);
CREATE INDEX IF NOT EXISTS clinical_snapshot_round ON clinical_snapshot(round_id,created_at DESC);
CREATE INDEX IF NOT EXISTS specimen_acceptance_round ON specimen_acceptance(round_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS p2_collection_fact_round_source ON p2_collection_fact(round_id,source,sequence DESC);
CREATE INDEX IF NOT EXISTS label_print_item_round ON label_print_item(round_id);
