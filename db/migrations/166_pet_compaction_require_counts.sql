-- Do not treat a missing or malformed count object as evidence of an empty scan.
CREATE OR REPLACE FUNCTION pet_empty_scan_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'append-only record'; END IF;
 IF current_setting('nipt.pet_empty_scan_compact',true) IS DISTINCT FROM 'yes'
   OR OLD.trigger<>'INTERVAL' OR OLD.outcome<>'SUCCESS'
   OR OLD.finished_at>=clock_timestamp()-interval '24 hours'
   OR OLD.error_code IS NOT NULL
   OR OLD.counts IS NULL OR jsonb_typeof(OLD.counts)<>'object'
   OR NOT (OLD.counts @> '{"stored":0,"parseError":0}'::jsonb)
   OR EXISTS(SELECT 1 FROM jsonb_each(OLD.counts) c WHERE c.value <> '0'::jsonb)
 THEN RAISE EXCEPTION 'SCAN_RECORD_IMMUTABLE'; END IF;
 RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION compact_pet_empty_scans(p_limit integer DEFAULT 500)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE deleted_count integer;
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>5000 THEN RAISE EXCEPTION 'PET_COMPACTION_LIMIT_INVALID'; END IF;
 PERFORM set_config('nipt.pet_empty_scan_compact','yes',true);
 WITH candidates AS (
  SELECT id FROM public.his_inbound_scan_run
  WHERE trigger='INTERVAL' AND outcome='SUCCESS'
   AND finished_at<clock_timestamp()-interval '24 hours'
   AND error_code IS NULL AND jsonb_typeof(counts)='object'
   AND counts @> '{"stored":0,"parseError":0}'::jsonb
   AND NOT EXISTS(SELECT 1 FROM jsonb_each(counts) c WHERE c.value <> '0'::jsonb)
  ORDER BY finished_at,id FOR UPDATE SKIP LOCKED LIMIT p_limit
 ), deleted AS (
  DELETE FROM public.his_inbound_scan_run x USING candidates c WHERE x.id=c.id RETURNING x.finished_at
 ), grouped AS (
  SELECT (finished_at AT TIME ZONE 'Asia/Bangkok')::date d,count(*)::bigint n,max(finished_at) t
  FROM deleted GROUP BY 1
 ), updated AS (
  INSERT INTO public.pet_scan_daily_empty_summary(bangkok_date,empty_success_runs,last_empty_scan_at)
  SELECT d,n,t FROM grouped
  ON CONFLICT(bangkok_date) DO UPDATE
   SET empty_success_runs=pet_scan_daily_empty_summary.empty_success_runs+excluded.empty_success_runs,
       last_empty_scan_at=GREATEST(pet_scan_daily_empty_summary.last_empty_scan_at,excluded.last_empty_scan_at),
       latest_compacted_at=clock_timestamp()
  RETURNING empty_success_runs
 ) SELECT count(*)::integer INTO deleted_count FROM deleted;
 PERFORM set_config('nipt.pet_empty_scan_compact','no',true);
 RETURN deleted_count;
END $$;
