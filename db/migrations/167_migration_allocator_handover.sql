-- Backfill only provenance links for records staged before the delta-linking service update.
INSERT INTO migration_execution_record(execution_id,record_id,source_key,row_number)
SELECT execution_id,id,source_key,row_number FROM migration_record ON CONFLICT DO NOTHING;
-- Additive handover gate; existing receipts/reservations and next calendar-month reset retain their original contracts.
CREATE TABLE migration_allocator_handover(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),execution_id uuid NOT NULL REFERENCES migration_execution,
 evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),evidence jsonb NOT NULL,
 applied_months jsonb NOT NULL,actor_id uuid NOT NULL REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(execution_id,evidence_sha256)
);
CREATE TRIGGER migration_allocator_handover_immutable BEFORE UPDATE OR DELETE ON migration_allocator_handover FOR EACH ROW EXECUTE FUNCTION immutable_row();
ALTER FUNCTION p4_issue_original_ln_halos(uuid,text) RENAME TO migration_original_issue_ln_halos;
CREATE FUNCTION p4_issue_original_ln_halos(p_round uuid,p_path text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE code text; BEGIN
 SELECT ln_halos INTO code FROM specimen_lab_number WHERE round_id=p_round;
 IF code IS NOT NULL THEN RETURN code; END IF;
 PERFORM pg_advisory_xact_lock(75432872);
 IF EXISTS(SELECT 1 FROM migration_record) AND NOT EXISTS(SELECT 1 FROM migration_allocator_handover) THEN RAISE EXCEPTION 'ALLOCATOR_HANDOVER_PENDING'; END IF;
 RETURN migration_original_issue_ln_halos(p_round,p_path);
END $$;
-- Recompile the outer receipt router so existing backend plans resolve the new guarded issuer.
DO $$ DECLARE definition text; BEGIN SELECT pg_get_functiondef('p4_ensure_ln_halos(uuid,text)'::regprocedure) INTO definition;EXECUTE definition;END $$;
CREATE FUNCTION migration_apply_allocator_handover(eid uuid,actor uuid,proof jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE e migration_execution; m jsonb; month_date date; counter integer; result jsonb:='[]'; prior migration_allocator_handover; BEGIN
 IF NOT EXISTS(SELECT 1 FROM app_user u JOIN role_assignment a ON a.user_id=u.id WHERE u.id=actor AND u.enabled AND a.role='APP_ADMIN' AND a.effective_from<=now() AND(a.expires_at IS NULL OR a.expires_at>now())) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 PERFORM pg_advisory_xact_lock(75432872);
 SELECT * INTO e FROM migration_execution WHERE id=eid FOR UPDATE;
 IF e.id IS NULL OR e.state NOT IN ('COMPLETED','PARTIAL') THEN RAISE EXCEPTION 'MIGRATION_EXECUTION_NOT_COMPLETE'; END IF;
 IF proof IS NULL OR proof->>'source' IS DISTINCT FROM 'GENOMIC_READ_ONLY_ALLOCATOR' OR proof->>'version' IS DISTINCT FROM '1' OR proof->>'sourceFrozen' IS DISTINCT FROM 'true'
 OR nullif(proof->>'sourceIdentity','') IS NULL OR nullif(proof->>'capturedAt','') IS NULL OR nullif(proof->>'registryPairCount','') IS NULL OR nullif(proof->>'sha256','') IS NULL OR proof->>'sha256' !~ '^[a-f0-9]{64}$'
 OR (proof->>'capturedAt')::timestamptz>clock_timestamp() OR (proof->>'capturedAt')::timestamptz<clock_timestamp()-interval '24 hours'
 OR proof->>'registryPairsSha256' IS DISTINCT FROM e.plan->>'registryPairsSha256'
 OR NOT EXISTS(SELECT 1 FROM migration_source s WHERE s.execution_id=eid AND s.kind='GENOMIC_MAPPING' AND s.sha256=proof->>'mappingSha256')
 OR jsonb_typeof(proof->'months') IS DISTINCT FROM 'array' OR jsonb_array_length(proof->'months')=0
 THEN RAISE EXCEPTION 'ALLOCATOR_EVIDENCE_INVALID_OR_STALE'; END IF;
 IF (proof->>'registryPairCount')::integer<>(SELECT count(*) FROM migration_execution_record WHERE execution_id=eid)
 OR (proof->>'registryPairCount')::integer<>jsonb_array_length(e.plan->'mappings')
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(e.plan->'mappings') p WHERE p->>'valid'<>'true' OR NOT EXISTS(SELECT 1 FROM migration_execution_record x JOIN migration_record r ON r.id=x.record_id WHERE x.execution_id=eid AND r.ln=p->>'hisLn' AND r.ln_halos=p->>'halosId' AND r.state='IMPORTED'))
 THEN RAISE EXCEPTION 'REGISTRY_DELTA_REQUIRES_REEXPORT'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(proof->'months'))<>(SELECT count(DISTINCT item->>'month') FROM jsonb_array_elements(proof->'months') item)
 OR EXISTS(SELECT 1 FROM migration_execution_record x JOIN migration_record r ON r.id=x.record_id WHERE x.execution_id=eid AND r.ln_halos ~ '^[0-9]{2}B[0-9]{9}' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(proof->'months') item WHERE to_char((item->>'month')::date,'YYMM')=substring(r.ln_halos from 4 for 4)))
 THEN RAISE EXCEPTION 'ALLOCATOR_MONTH_COVERAGE_INVALID'; END IF;
 SELECT * INTO prior FROM migration_allocator_handover WHERE execution_id=eid AND evidence_sha256=proof->>'sha256';
 IF prior.id IS NOT NULL THEN RETURN jsonb_build_object('id',prior.id,'months',prior.applied_months,'replayed',true); END IF;
 -- Shared order with the normal issuer: audit-chain before calendar month rows.
 PERFORM pg_advisory_xact_lock(75432801);
 FOR m IN SELECT value FROM jsonb_array_elements(proof->'months') ORDER BY value->>'month' LOOP
  IF m->>'month' !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-01$' OR m->>'lastValue' !~ '^[0-9]{1,3}$' THEN RAISE EXCEPTION 'ALLOCATOR_MONTH_INVALID'; END IF;
  month_date:=(m->>'month')::date;counter:=(m->>'lastValue')::integer;
  IF counter>999 OR EXISTS(SELECT 1 FROM migration_execution_record x JOIN migration_record r ON r.id=x.record_id WHERE x.execution_id=eid AND substring(r.ln_halos from 4 for 4)=to_char(month_date,'YYMM') AND substring(r.ln_halos from 10 for 3)::integer>counter) THEN RAISE EXCEPTION 'ALLOCATOR_BELOW_EXPORTED_IDENTIFIER'; END IF;
  INSERT INTO ln_halos_monthly_sequence(sequence_month,last_value) VALUES(month_date,counter) ON CONFLICT(sequence_month) DO UPDATE SET last_value=greatest(ln_halos_monthly_sequence.last_value,excluded.last_value) RETURNING last_value INTO counter;
  result:=result||jsonb_build_array(jsonb_build_object('month',month_date,'lastValue',counter));
 END LOOP;
 INSERT INTO migration_allocator_handover(execution_id,evidence_sha256,evidence,applied_months,actor_id) VALUES(eid,proof->>'sha256',proof,result,actor) RETURNING * INTO prior;
 UPDATE migration_execution SET watermark=proof,row_version=row_version+1 WHERE id=eid;
 RETURN jsonb_build_object('id',prior.id,'months',result,'replayed',false);
END $$;
-- Keep raw HALOS text intact; the only matching normalization is surrounding whitespace (never suffix removal).
DO $$ DECLARE d text; BEGIN
 SELECT pg_get_functiondef('migration_result_source_current(uuid)'::regprocedure) INTO d;
 IF position('a.sample_raw=v.parsed' in d)=0 THEN RAISE EXCEPTION 'MIGRATION_RESULT_SOURCE_GUARD_SHAPE_MISMATCH'; END IF;
 EXECUTE replace(d,'a.sample_raw=v.parsed',E'btrim(a.sample_raw,E'' \\t\\r\\n'')=v.parsed');
END $$;
REVOKE ALL ON migration_allocator_handover FROM PUBLIC;
REVOKE ALL ON FUNCTION migration_original_issue_ln_halos(uuid,text),p4_issue_original_ln_halos(uuid,text),migration_apply_allocator_handover(uuid,uuid,jsonb) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_rw') THEN GRANT SELECT ON migration_allocator_handover TO app_rw;GRANT EXECUTE ON FUNCTION migration_apply_allocator_handover(uuid,uuid,jsonb) TO app_rw; END IF; END $$;
