-- Owner 2026-11-04: deleting an EQA was still refused (EQA_HAS_DOWNSTREAM_WORK, detail phi_access_log): merely opening the case page writes a view-log row for it, so a viewed EQA could never be deleted.
-- View logs (phi_access_log, result_access_log) are not downstream work; they go with the registration. The tombstone and the audit chain remain.
-- Rewritten from the installed definition (193 is applied and immutable); a missing pattern stops the migration.
DO $eqa$
DECLARE def text; fixed text;
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p WHERE p.proname='eqa_delete_registration' AND p.pronamespace='public'::regnamespace;
 IF def IS NULL THEN RAISE EXCEPTION 'EQA_DELETE_FUNCTION_NOT_FOUND'; END IF;
 fixed:=replace(def,'''lab_operational_registration'')','''lab_operational_registration'',''phi_access_log'',''result_access_log'')');
 IF fixed=def OR fixed NOT LIKE '%phi_access_log%' THEN RAISE EXCEPTION 'EQA_DELETE_LOG_PATTERN_NOT_FOUND'; END IF;
 EXECUTE fixed;
END $eqa$;
