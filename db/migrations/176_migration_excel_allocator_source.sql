-- Owner decision 2026-11-02: the Excel mapping is the source of truth for the LN Halos hand-over (no Genomic-CBH database access).
-- The hand-over function keeps every other check (APP_ADMIN actor, fresh evidence, registry digest, month coverage, no counter below an exported number)
-- and only accepts a second named evidence source. Forward-only, replaces the function in place the way migration 173 did.
DO $$ DECLARE definition text; old text:='proof->>''source'' IS DISTINCT FROM ''GENOMIC_READ_ONLY_ALLOCATOR''';
BEGIN
 SELECT pg_get_functiondef('migration_apply_allocator_handover(uuid,uuid,jsonb)'::regprocedure) INTO definition;
 IF position(old in definition)=0 THEN RAISE EXCEPTION 'MIGRATION_ALLOCATOR_SOURCE_SHAPE_MISMATCH'; END IF;
 EXECUTE replace(definition,old,'COALESCE(proof->>''source'','''') NOT IN (''GENOMIC_READ_ONLY_ALLOCATOR'',''OWNER_CONFIRMED_EXCEL_MAPPING'')');
END $$;
