-- PostgreSQL may reorder EXISTS predicates; an unrelated invalid old staged identifier must never reach an integer cast.
-- Raw legacy exceptions remain preserved and cannot affect a valid execution's independent handover.
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('migration_apply_allocator_handover(uuid,uuid,jsonb)'::regprocedure) INTO definition;
 IF position('substring(r.ln_halos from 10 for 3)::integer>counter' in definition)=0 THEN RAISE EXCEPTION 'MIGRATION_ALLOCATOR_CAST_GUARD_SHAPE_MISMATCH'; END IF;
 EXECUTE replace(definition,'substring(r.ln_halos from 10 for 3)::integer>counter',
  'CASE WHEN r.ln_halos ~ ''^[0-9]{2}B[0-9]{9}'' THEN substring(r.ln_halos from 10 for 3)::integer ELSE NULL END>counter');
END $$;
