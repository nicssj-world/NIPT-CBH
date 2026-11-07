-- Pooling amount changes every calculated transfer volume. Preserve the original
-- QC/placement checks and compare against the revision used to record transfers.
CREATE OR REPLACE FUNCTION lab_actual_pooling_current(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM lab_actual_pooling p JOIN lab_batch b ON b.id=p.batch_id
 JOIN task_workbook_revision recorded ON recorded.id=p.workbook_revision_id
 JOIN LATERAL(SELECT * FROM task_workbook_revision WHERE batch_id=b.id ORDER BY revision DESC LIMIT 1) r ON true
 WHERE p.id=target AND b.state<>'Cancelled' AND NOT EXISTS(SELECT 1 FROM lab_batch_removal WHERE batch_id=b.id)
 AND p.id=(SELECT id FROM lab_actual_pooling WHERE batch_id=b.id ORDER BY recorded_at DESC,id DESC LIMIT 1)
 AND p.placements=r.source_snapshot->'placements'
 AND COALESCE(NULLIF(recorded.values->'pool.amount','null'::jsonb),'16'::jsonb)=COALESCE(NULLIF(r.values->'pool.amount','null'::jsonb),'16'::jsonb)
 AND p.qc_values=(SELECT jsonb_object_agg(key,value) FROM jsonb_each(r.values) WHERE key ~ '^slot\.[0-9]+\.libraryQc$|^qc\.[123]\.'))
$$;
