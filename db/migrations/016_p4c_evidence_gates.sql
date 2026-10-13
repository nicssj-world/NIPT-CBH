-- Strengthen SQL boundaries after synthetic integration review. Forward-only.
ALTER TABLE p4c_dnb_attempt ADD CONSTRAINT p4c_dnb_explicit_hold CHECK((payload->>'synthetic'='true' AND payload->>'clinicalUsable'='false' AND payload->>'acceptance'='HOLD' AND preparation->>'method'='UNRESOLVED_OD32_WC05') IS TRUE);
ALTER TABLE p4c_handoff ADD CONSTRAINT p4c_handoff_explicit_simulation CHECK((payload->>'vendorCompatible'='false' AND payload->>'purpose'='SYNTHETIC_SIMULATION' AND jsonb_typeof(payload->'members')='array' AND jsonb_typeof(payload->'mappedMembers')='array') IS TRUE);
ALTER TABLE p4c_sequencing_attempt ADD CONSTRAINT p4c_sequence_explicit_simulation CHECK((record->>'purpose'='SYNTHETIC_SIMULATION' AND record->>'equipmentModel'='DNBSEQ-G50') IS TRUE);
ALTER TABLE p4c_document ADD CONSTRAINT p4c_f5_explicit_simulation CHECK((snapshot->>'form'='F5' AND snapshot->>'synthetic'='true' AND snapshot->>'clinicalUsable'='false' AND snapshot->>'purpose'='SYNTHETIC_SIMULATION' AND snapshot->>'preview'='false') IS TRUE);
ALTER TABLE p4c_document ADD CONSTRAINT p4c_f5_once_per_kind UNIQUE(dnb_id,kind);

CREATE FUNCTION p4c_f5_ready(did uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 WITH run AS (SELECT id FROM p4c_sequencing_attempt WHERE dnb_id=did ORDER BY attempt_number DESC LIMIT 1),
 h AS (SELECT payload FROM p4c_handoff WHERE dnb_id=did ORDER BY revision DESC LIMIT 1),
 current_qc AS (SELECT o.*,r.result FROM p4c_qc4_observation o LEFT JOIN p4c_qc4_review r ON r.qc4_id=o.id WHERE o.sequencing_id=(SELECT id FROM run) AND NOT EXISTS(SELECT 1 FROM p4c_qc4_observation x WHERE x.supersedes_id=o.id))
 SELECT p4c_pool_current(did) AND p4c_qc3_ready(did) AND p4c_handoff_verified(did)
 AND EXISTS(SELECT 1 FROM p4c_dnb_event WHERE dnb_id=did AND event_type='SEQUENCE_END' AND payload->>'sequencingId'=(SELECT id::text FROM run))
 AND NOT EXISTS(SELECT 1 FROM p4c_dnb_event WHERE dnb_id=did AND event_type='SEQUENCE_HOLD' AND payload->>'sequencingId'=(SELECT id::text FROM run))
 AND EXISTS(SELECT 1 FROM current_qc WHERE scope='LANE' AND result='SyntheticReviewed' AND event_time IS NOT NULL)
 AND (SELECT jsonb_array_length(payload->'mappedMembers')=47 FROM h) IS TRUE
 AND NOT EXISTS(SELECT 1 FROM h,jsonb_array_elements(h.payload->'mappedMembers') m WHERE NOT EXISTS(SELECT 1 FROM current_qc o WHERE scope='SAMPLE' AND member_key=m->>'memberKey' AND result='SyntheticReviewed' AND event_time IS NOT NULL))
 AND NOT EXISTS(SELECT 1 FROM current_qc WHERE result IS DISTINCT FROM 'SyntheticReviewed' OR event_time IS NULL);
$$;
CREATE FUNCTION p4c_f5_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE d p4c_dnb_attempt; BEGIN
 SELECT * INTO d FROM p4c_dnb_attempt WHERE id=NEW.dnb_id;PERFORM id FROM lab_batch WHERE id=d.batch_id FOR UPDATE;
 IF NOT p4c_pool_current(d.id) THEN RAISE EXCEPTION 'DNB_STOP_USE'; END IF;
 IF NEW.snapshot->>'docId' IS DISTINCT FROM NEW.id::text OR NEW.snapshot->>'dnbId' IS DISTINCT FROM d.id::text OR NEW.snapshot->>'batchId' IS DISTINCT FROM d.batch_id::text
 OR NEW.snapshot->>'poolSnapshotId' IS DISTINCT FROM d.pool_snapshot_id::text OR NEW.snapshot->>'kind' IS DISTINCT FROM NEW.kind OR (NEW.snapshot->>'revision')::int IS DISTINCT FROM NEW.revision
 OR NEW.snapshot->>'poolHash' IS DISTINCT FROM d.source_sha256 THEN RAISE EXCEPTION 'F5_SOURCE_MISMATCH'; END IF;
 IF NEW.kind='PRE_WORK' THEN
 IF EXISTS(SELECT 1 FROM p4c_dnb_event WHERE dnb_id=d.id AND event_type='DNB_START') THEN RAISE EXCEPTION 'PRE_WORK_BEFORE_EXECUTION_ONLY'; END IF;
 IF jsonb_array_length(NEW.snapshot->'fields') IS DISTINCT FROM 17 OR NEW.snapshot->'evidence' IS DISTINCT FROM '[]'::jsonb
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.snapshot->'fields') f WHERE f->'actual' IS DISTINCT FROM 'null'::jsonb) THEN RAISE EXCEPTION 'PRE_WORK_ACTUALS_FORBIDDEN'; END IF;
 ELSE
 IF p4c_f5_ready(d.id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'F5_COMPLETION_EVIDENCE_INCOMPLETE'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM p4c_dnb_event e WHERE e.dnb_id=d.id AND e.event_type='PREVIEW' AND e.actor_id=NEW.issued_by AND e.payload->>'kind'=NEW.kind AND e.payload->>'evidenceHash'=NEW.snapshot->>'evidenceHash') THEN RAISE EXCEPTION 'CURRENT_PREVIEW_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER p4c_f5_guard BEFORE INSERT ON p4c_document FOR EACH ROW EXECUTE FUNCTION p4c_f5_guard();
CREATE FUNCTION p4c_lifecycle_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE k text; v text; BEGIN
 IF NEW.event_type IN ('PRE_WORK','COMPLETED') THEN
 IF NOT EXISTS(SELECT 1 FROM p4c_document d WHERE d.id::text=NEW.payload->>'documentId' AND d.dnb_id=NEW.dnb_id AND d.kind=NEW.event_type AND d.file_sha256=NEW.payload->>'sha256') THEN RAISE EXCEPTION 'F5_ISSUED_ORIGINAL_REQUIRED'; END IF;
 IF NEW.event_type='COMPLETED' AND p4c_f5_ready(NEW.dnb_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'F5_COMPLETION_EVIDENCE_INCOMPLETE'; END IF;
 END IF;
 IF NEW.event_type='SEQUENCE_END' THEN
 IF jsonb_typeof(NEW.payload->'firstCycle') IS DISTINCT FROM 'object' OR NEW.payload->>'postWash' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'FIRST_CYCLE_AND_POST_WASH_REQUIRED'; END IF;
 FOREACH k IN ARRAY ARRAY['loadedDnb','q30','bic','fit'] LOOP
 v:=NEW.payload->'firstCycle'->>k;
 IF v IS NULL OR v !~ '^(0|[1-9][0-9]{0,5})(\.[0-9]{1,8})?$' THEN RAISE EXCEPTION 'FIRST_CYCLE_NUMERIC_REQUIRED'; END IF;
 END LOOP;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER p4c_lifecycle_guard BEFORE INSERT ON p4c_dnb_event FOR EACH ROW EXECUTE FUNCTION p4c_lifecycle_guard();
CREATE OR REPLACE FUNCTION p4c_paper_usable(did uuid,cid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT p4c_pool_current(did) AND EXISTS(SELECT 1 FROM p4c_document_copy c JOIN p4c_document d ON d.id=c.document_id WHERE c.id=cid AND d.dnb_id=did AND d.kind='PRE_WORK' AND c.kind='WORKING_COPY'
 AND NOT EXISTS(SELECT 1 FROM p4c_dnb_event e WHERE e.dnb_id=did AND (e.event_type='COMPLETED' OR (e.event_type='RECALL' AND e.payload->>'copyId'=c.id::text))));
$$;
CREATE FUNCTION p4c_copy_current_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE d p4c_document; BEGIN
 SELECT * INTO d FROM p4c_document WHERE id=NEW.document_id;PERFORM b.id FROM lab_batch b JOIN p4c_dnb_attempt a ON a.batch_id=b.id WHERE a.id=d.dnb_id FOR UPDATE OF b;
 IF NEW.kind='WORKING_COPY' AND (d.kind<>'PRE_WORK' OR NOT p4c_pool_current(d.dnb_id) OR EXISTS(SELECT 1 FROM p4c_dnb_event WHERE dnb_id=d.dnb_id AND event_type='COMPLETED')) THEN RAISE EXCEPTION 'WORKING_COPY_NOT_USABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER p4c_copy_current_guard BEFORE INSERT ON p4c_document_copy FOR EACH ROW EXECUTE FUNCTION p4c_copy_current_guard();
-- Direct INSERT reviews take the same batch lock as observations/corrections.
CREATE FUNCTION p4c_review_lock() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE did uuid; BEGIN
 IF TG_TABLE_NAME='p4c_qc4_review' THEN SELECT s.dnb_id INTO did FROM p4c_qc4_observation o JOIN p4c_sequencing_attempt s ON s.id=o.sequencing_id WHERE o.id=NEW.qc4_id;
 ELSIF TG_TABLE_NAME='p4c_dnb_review' THEN SELECT dnb_id INTO did FROM p4c_dnb_observation WHERE id=NEW.observation_id;
 ELSE did:=NEW.dnb_id; END IF;
 PERFORM b.id FROM lab_batch b JOIN p4c_dnb_attempt d ON d.batch_id=b.id WHERE d.id=did FOR UPDATE OF b;
 IF p4c_pool_current(did) IS DISTINCT FROM true THEN RAISE EXCEPTION 'DNB_STOP_USE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER p4c_00_review_lock BEFORE INSERT ON p4c_dnb_review FOR EACH ROW EXECUTE FUNCTION p4c_review_lock();
CREATE TRIGGER p4c_00_review_lock BEFORE INSERT ON p4c_qc3_decision FOR EACH ROW EXECUTE FUNCTION p4c_review_lock();
CREATE TRIGGER p4c_00_review_lock BEFORE INSERT ON p4c_qc4_review FOR EACH ROW EXECUTE FUNCTION p4c_review_lock();

-- Validate the frozen internal plan against every mapped member, not only its digest.
CREATE FUNCTION p4c_cell_plan_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE r jsonb; m jsonb; n bigint; BEGIN
 IF NEW.mapping_status='MAPPING_UNAVAILABLE' THEN
 IF NEW.payload->'mappedMembers' IS DISTINCT FROM '[]'::jsonb OR NEW.payload->'cellPlan' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'UNAVAILABLE_MAPPING_NO_FILE'; END IF;
 RETURN NEW; END IF;
 IF NEW.payload->'cellPlan'->>'sheet' IS DISTINCT FROM 'Sheet1' OR NEW.payload->'cellPlan'->>'range' IS DISTINCT FROM 'A1:E48'
 OR jsonb_array_length(NEW.payload->'cellPlan'->'rows') IS DISTINCT FROM 47 THEN RAISE EXCEPTION 'HALOS_CONTRACT_MISMATCH'; END IF;
 FOR r,n IN SELECT value,ordinality FROM jsonb_array_elements(NEW.payload->'cellPlan'->'rows') WITH ORDINALITY LOOP
 m:=NEW.payload->'mappedMembers'->(n::int-1);
 IF (r->>'excelRow')::int IS DISTINCT FROM n+1 OR r->'source' IS DISTINCT FROM m
 OR r->'cells' IS DISTINCT FROM jsonb_build_array(jsonb_build_object('type','string','value',m->>'exportSampleId'),jsonb_build_object('type','string','value','L01'),jsonb_build_object('type','string','value',NEW.payload->>'dnbLabel'),jsonb_build_object('type','number','value',m->'barcodeIndex'),jsonb_build_object('type','blank'))
 THEN RAISE EXCEPTION 'HALOS_CELL_PLAN_SOURCE_MISMATCH'; END IF;
 END LOOP; RETURN NEW;
END $$;
CREATE TRIGGER p4c_cell_plan_guard BEFORE INSERT ON p4c_handoff FOR EACH ROW EXECUTE FUNCTION p4c_cell_plan_guard();

CREATE OR REPLACE FUNCTION p4c_verification_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE t p4c_handoff_transfer; h p4c_handoff; BEGIN
 SELECT * INTO t FROM p4c_handoff_transfer WHERE id=NEW.transfer_id; SELECT * INTO h FROM p4c_handoff WHERE id=t.handoff_id;
 PERFORM b.id FROM lab_batch b JOIN p4c_dnb_attempt d ON d.batch_id=b.id WHERE d.id=h.dnb_id FOR UPDATE OF b;
 IF t.actor_id=NEW.reviewer_id THEN RAISE EXCEPTION 'SECOND_PERSON_REQUIRED'; END IF;
 IF NOT p4c_pool_current(h.dnb_id) OR t.sequence<>(SELECT max(sequence) FROM p4c_handoff_transfer WHERE handoff_id=t.handoff_id) THEN RAISE EXCEPTION 'TRANSFER_NOT_CURRENT'; END IF;
 IF NEW.result='MATCH' AND (t.status IS DISTINCT FROM 'Complete' OR NEW.errors IS DISTINCT FROM '[]'::jsonb OR NEW.observed->>'status' IS DISTINCT FROM 'Complete'
 OR NEW.observed->>'fileHash' IS DISTINCT FROM h.file_sha256 OR NEW.observed->'observedRows' IS DISTINCT FROM h.payload->'mappedMembers'
 OR NEW.observed->>'observedDnbId' IS DISTINCT FROM h.payload->>'dnbLabel' OR NEW.observed->>'lane' IS DISTINCT FROM 'L01') THEN RAISE EXCEPTION 'HANDOFF_EXACT_MATCH_REQUIRED'; END IF;
 RETURN NEW;
END $$;
