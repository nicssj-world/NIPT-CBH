-- Durable preparation is already the beginning of allocator cutover, even before the first patient record is staged.
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('p4_issue_original_ln_halos(uuid,text)'::regprocedure) INTO definition;
 IF position('EXISTS(SELECT 1 FROM migration_record)' in definition)=0 THEN RAISE EXCEPTION 'MIGRATION_PREPARE_ALLOCATOR_GUARD_SHAPE_MISMATCH'; END IF;
 EXECUTE replace(definition,'EXISTS(SELECT 1 FROM migration_record)','EXISTS(SELECT 1 FROM migration_execution)');
 -- Flush existing receipt-router plans as well; original reservations still return before the guarded issuer.
 SELECT pg_get_functiondef('p4_ensure_ln_halos(uuid,text)'::regprocedure) INTO definition;EXECUTE definition;
END $$;
