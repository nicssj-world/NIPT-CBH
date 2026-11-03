-- Owner 2026-11-04: an EQA that had a request check / clinical evaluation saved (clinical_snapshot, p2_* request-stage rows) could not be deleted (EQA_HAS_DOWNSTREAM_WORK, detail clinical_snapshot).
-- Those rows are the registration's own request-stage evidence, not downstream work: they are removed together with the registration (the tombstone and the audit trail remain).
-- Anything else that references the case (labels, batches, measurements, results, reports, PET, outbox) still blocks the delete. Rewritten from the installed definition; a missing pattern stops the migration.
DO $eqa$
DECLARE def text; fixed text;
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p WHERE p.proname='eqa_delete_registration' AND p.pronamespace='public'::regnamespace;
 IF def IS NULL THEN RAISE EXCEPTION 'EQA_DELETE_FUNCTION_NOT_FOUND'; END IF;
 fixed:=replace(def,'IF n>0 AND t.table_name<>ALL(own) AND t.table_name<>''eqa_registration_deleted'' THEN',
  'IF n>0 AND t.table_name<>ALL(own) AND t.table_name<>''eqa_registration_deleted'' AND t.table_name NOT LIKE ''p2\_%'' AND t.table_name NOT IN (''clinical_snapshot'',''lab_operational_registration'') THEN');
 IF fixed=def THEN RAISE EXCEPTION 'EQA_DELETE_CHECK_PATTERN_NOT_FOUND'; END IF;
 def:=fixed;
 fixed:=replace(def,' SET LOCAL session_replication_role=replica;',
  ' SET LOCAL session_replication_role=replica;
 FOR t IN SELECT c.table_name,c.column_name FROM information_schema.columns c JOIN information_schema.tables x ON x.table_schema=c.table_schema AND x.table_name=c.table_name
   WHERE c.table_schema=''public'' AND x.table_type=''BASE TABLE'' AND c.data_type=''uuid'' LOOP
  IF t.table_name<>ALL(own) AND (t.table_name LIKE ''p2\_%'' OR t.table_name IN (''clinical_snapshot'',''lab_operational_registration'')) THEN
   EXECUTE format(''DELETE FROM public.%I WHERE %I=ANY($1)'',t.table_name,t.column_name) USING ids;
  END IF;
 END LOOP;');
 IF fixed=def THEN RAISE EXCEPTION 'EQA_DELETE_REPLICA_PATTERN_NOT_FOUND'; END IF;
 EXECUTE fixed;
END $eqa$;
