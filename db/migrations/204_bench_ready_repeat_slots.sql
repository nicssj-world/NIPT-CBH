-- A patient slot whose attempt failed QC (or was stopped/cancelled) and was sent to a Re-xxx
-- repeat is excluded from Pooling, so the release gate no longer demands a QC value >= 2.00
-- or an active attempt for it. Everything else is the unchanged migration 117 definition.
CREATE OR REPLACE FUNCTION lab_bench_measurements_ready(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE r task_workbook_revision; v jsonb; placement jsonb; s jsonb; k text; n numeric; repeating boolean;
BEGIN
 SELECT * INTO r FROM task_workbook_revision WHERE batch_id=target ORDER BY revision DESC LIMIT 1;
 IF r.id IS NULL OR NOT nipt_operational_enabled() OR r.master_sha256<>'4c5300f9039af57c0d0649160f5da8e4c2ee1ed7ae44dd7aa525823104f9c7f1'
 OR NOT EXISTS(SELECT 1 FROM lab_batch b WHERE b.id=target AND b.state<>'Cancelled')
 OR EXISTS(SELECT 1 FROM lab_batch_removal WHERE batch_id=target)
 OR jsonb_typeof(r.source_snapshot->'placements') IS DISTINCT FROM 'array'
 OR jsonb_array_length(r.source_snapshot->'placements')<>3 THEN RETURN false; END IF;
 v:=r.values;
 FOR placement IN SELECT jsonb_array_elements(r.source_snapshot->'placements') LOOP
  IF NOT EXISTS(SELECT 1 FROM lab_placement_snapshot p JOIN lab_task_sheet t ON t.id=p.sheet_id WHERE p.id::text=placement->>'id' AND t.batch_id=target AND p.content_hash=placement->>'content_hash' AND p.payload=placement->'payload' AND p.revision=(SELECT max(x.revision) FROM lab_placement_snapshot x WHERE x.sheet_id=t.id)) THEN RETURN false; END IF;
  FOR s IN SELECT jsonb_array_elements(placement->'payload'->'slots') LOOP
   k:='slot.'||(s->>'slot')||'.libraryQc';
   -- A patient whose attempt failed/stopped and was sent to any Re-xxx is not pooled: no QC value or active attempt is required.
   repeating:=s->>'control' IS NULL AND s->>'attemptId' IS NOT NULL AND EXISTS(SELECT 1 FROM lab_slot_assignment a JOIN analytical_attempt x ON x.id=a.attempt_id WHERE a.batch_id=target AND a.attempt_id::text=s->>'attemptId' AND a.slot_number=(s->>'slot')::int AND x.state IN ('QcFailed','Superseded','Stopped','BatchCancelled'));
   IF repeating THEN CONTINUE; END IF;
   IF s->>'control' IS NOT NULL OR s->>'attemptId' IS NOT NULL THEN
    IF jsonb_typeof(v->k) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
    n:=(v->>k)::numeric;
    -- QC1 may accept a measured BLANK zero; the separate preserved Pooling
    -- formula cannot divide by zero and therefore cannot complete that artifact.
    IF n=0 THEN RETURN false; END IF;
    IF s->>'control'='blank' THEN IF n<0 OR n>0.60 THEN RETURN false; END IF;
    ELSE IF n<2.00 THEN RETURN false; END IF; END IF;
   ELSIF v->>k IS NOT NULL THEN RETURN false;
   END IF;
   IF s->>'attemptId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM lab_slot_assignment a JOIN analytical_attempt x ON x.id=a.attempt_id JOIN nipt_case c ON c.id=x.case_id WHERE a.batch_id=target AND a.attempt_id::text=s->>'attemptId' AND a.slot_number=(s->>'slot')::int AND a.removed_at IS NULL AND x.round_id=c.current_round_id AND x.state IN ('Assigned','InProgress','AnalysisComplete','FinalQcAccepted','Final')) THEN RETURN false; END IF;
  END LOOP;
 END LOOP;
 FOR k IN SELECT 'qc.'||strip||'.'||field FROM generate_series(1,3) strip CROSS JOIN unnest(ARRAY['standard1','standard2','standard2Concentration']) field LOOP
  IF jsonb_typeof(v->k) IS DISTINCT FROM 'number' OR (v->>k)::numeric<0 THEN RETURN false; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['pool.standard1','pool.standard2','pool.standard2Concentration','pool.concentration'] LOOP
  IF jsonb_typeof(v->k) IS DISTINCT FROM 'number' OR (v->>k)::numeric<0 THEN RETURN false; END IF;
 END LOOP;
 n:=(v->>'pool.concentration')::numeric;
 IF n<3.00 OR n>3.60 THEN
  IF jsonb_typeof(v->'pool.dilutionC1') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
  n:=(v->>'pool.dilutionC1')::numeric;
  -- Equivalent to the preserved Master EB formula being finite and non-negative.
  IF n<=0 OR 100-(3.33*100)/n<0 THEN RETURN false; END IF;
 END IF;
 FOREACH k IN ARRAY ARRAY['seq.instrument','seq.barcodeType','seq.standard1','seq.standard2','seq.standard2Concentration','seq.dnbConcentration','seq.dilutedConcentration','seq.driveMemoryTb','seq.negativePressureKpa','seq.loadedDnb','seq.q30','seq.bic','seq.fit'] LOOP
  IF jsonb_typeof(v->k) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
  IF k<>'seq.negativePressureKpa' AND (v->>k)::numeric<0 THEN RETURN false; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['seq.date','seq.operator','seq.dnbId','seq.reagentConfirmation.28','seq.reagentConfirmation.29','seq.reagentConfirmation.30','seq.reagentConfirmation.31'] LOOP
  IF jsonb_typeof(v->k) IS DISTINCT FROM 'string' OR length(trim(v->>k))=0 THEN RETURN false; END IF;
 END LOOP;
 IF v->'seq.chipPositionedFirmly' IS DISTINCT FROM 'true'::jsonb THEN RETURN false; END IF;
 -- Review binds an actual current vendor export, not merely a UI field.
 IF NOT EXISTS(SELECT 1 FROM lab_bench_export e WHERE e.batch_id=target AND e.workbook_revision_id=r.id AND e.kind='NIFTY_XLSX') THEN RETURN false; END IF;
 RETURN true;
END $$;
