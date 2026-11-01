-- Authentic pre-cutover analytical attempts are evidence, not newly requested clinical repeat orders.
ALTER TABLE analytical_attempt ADD COLUMN historical_source_id uuid UNIQUE REFERENCES migration_analysis(id);
DO $$ DECLARE constraint_name text; matches integer; BEGIN
 SELECT count(*),min(conname) INTO matches,constraint_name FROM pg_constraint
 WHERE conrelid='analytical_attempt'::regclass AND contype='c'
 AND position('repeat_order_id' in pg_get_constraintdef(oid))>0 AND position('attempt_number' in pg_get_constraintdef(oid))>0;
 IF matches<>1 THEN RAISE EXCEPTION 'MIGRATION_REPEAT_CONSTRAINT_SHAPE_MISMATCH'; END IF;
 EXECUTE format('ALTER TABLE analytical_attempt DROP CONSTRAINT %I',constraint_name);
END $$;
ALTER TABLE analytical_attempt ADD CONSTRAINT analytical_attempt_repeat_or_historical_source
 CHECK((historical_source_id IS NULL AND ((attempt_number=1 AND repeat_order_id IS NULL) OR (attempt_number>=2 AND repeat_order_id IS NOT NULL)))
 OR (historical_source_id IS NOT NULL AND repeat_order_id IS NULL));
CREATE FUNCTION migration_historical_attempt_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.historical_source_id IS DISTINCT FROM OLD.historical_source_id THEN RAISE EXCEPTION 'HISTORICAL_ATTEMPT_SOURCE_IMMUTABLE'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.historical_source_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM migration_analysis a JOIN migration_record m ON m.id=a.record_id JOIN migration_source s ON s.id=a.source_id
  JOIN migration_historical_run h ON h.run_label=a.run_label AND h.source_sha256=s.sha256
  WHERE a.id=NEW.historical_source_id AND a.classification='ANALYSIS' AND a.attempt_id IS NULL AND m.state='IMPORTED'
  AND (m.case_id,m.round_id)=(NEW.case_id,NEW.round_id) AND a.attempt_number=NEW.attempt_number
  AND btrim(a.sample_raw,E' \t\r\n')=NEW.printed_sample_id
  AND ((a.is_current AND NEW.state='Ready') OR (NOT a.is_current AND a.superseded_by IS NOT NULL AND NEW.state='Superseded'))
 ) THEN RAISE EXCEPTION 'HISTORICAL_ATTEMPT_AUTHENTIC_SOURCE_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER migration_historical_attempt_guard BEFORE INSERT OR UPDATE ON analytical_attempt FOR EACH ROW EXECUTE FUNCTION migration_historical_attempt_guard();
