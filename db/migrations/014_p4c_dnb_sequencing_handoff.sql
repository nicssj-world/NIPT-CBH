-- Restricted synthetic DNB/QC3, G50/QC4 and HALOS handoff. No clinical acceptance.
CREATE TABLE p4c_dnb_attempt(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid NOT NULL REFERENCES lab_batch,
 pool_snapshot_id uuid NOT NULL REFERENCES p4b_pool_snapshot,attempt_number integer NOT NULL CHECK(attempt_number>0),
 revision integer NOT NULL DEFAULT 1 CHECK(revision=1),supersedes_id uuid REFERENCES p4c_dnb_attempt,
 purpose text NOT NULL CHECK(purpose='SYNTHETIC_SIMULATION'),actual_date date NOT NULL,dnb_label text NOT NULL,
 preparation jsonb NOT NULL,payload jsonb NOT NULL,sha256 text NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'),
 source_sha256 text NOT NULL CHECK(source_sha256~'^[a-f0-9]{64}$'),reason text NOT NULL CHECK(length(trim(reason))>=8),
 created_by uuid NOT NULL REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(batch_id,attempt_number),UNIQUE(supersedes_id),CHECK(dnb_label='DNB'||to_char(actual_date,'YYYYMMDD')),
 CHECK(payload->>'acceptance'='HOLD' AND payload->>'clinicalUsable'='false'),CHECK(preparation->>'method'='UNRESOLVED_OD32_WC05')
);
CREATE TABLE p4c_dnb_event(
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 dnb_id uuid NOT NULL REFERENCES p4c_dnb_attempt,event_type text NOT NULL CHECK(event_type IN
 ('DNB_START','DNB_END','HOLD','STOP_USE','SUPERSEDED','RECALL','PREVIEW','PRE_WORK','COMPLETED','SEQUENCE_START','SEQUENCE_END','ANALYSIS_COMPLETE','SEQUENCE_HOLD')),
 payload jsonb NOT NULL,actor_id uuid REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(actor_id IS NOT NULL OR (event_type='STOP_USE' AND payload->>'systemGenerated'='true'))
);
CREATE TABLE p4c_dnb_observation(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 dnb_id uuid NOT NULL REFERENCES p4c_dnb_attempt,field text NOT NULL CHECK(field IN ('STD1','STD2','QC3')),
 value text NOT NULL CHECK(value~'^(0|[1-9][0-9]{0,5})(\.[0-9]{1,8})?$'),unit text NOT NULL CHECK(unit='ng/uL'),
 source text NOT NULL CHECK(source IN ('DIRECT_ENTRY','PAPER_TRANSCRIPTION')),copy_id uuid,
 event_time timestamptz,event_precision text NOT NULL CHECK(event_precision IN ('MINUTE','DAY','NOT_RECORDED')),
 paper_operator text,paper_evidence_hash text CHECK(paper_evidence_hash~'^[a-f0-9]{64}$'),
 recorded_by uuid NOT NULL REFERENCES app_user,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 supersedes_id uuid UNIQUE REFERENCES p4c_dnb_observation,reason text,
 CHECK((source='PAPER_TRANSCRIPTION')=(copy_id IS NOT NULL)),CHECK((event_time IS NULL)=(event_precision='NOT_RECORDED')),
 CHECK(event_time IS NULL OR event_time<=recorded_at),CHECK(supersedes_id IS NULL OR length(trim(reason))>=8)
);
CREATE TABLE p4c_dnb_review(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),observation_id uuid NOT NULL UNIQUE REFERENCES p4c_dnb_observation,
 result text NOT NULL CHECK(result IN ('Confirmed','Discrepancy')),reviewer_id uuid NOT NULL REFERENCES app_user,
 note text NOT NULL CHECK(length(trim(note))>=8),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE p4c_qc3_decision(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,dnb_id uuid NOT NULL REFERENCES p4c_dnb_attempt,
 observation_id uuid NOT NULL REFERENCES p4c_dnb_observation,decision text NOT NULL CHECK(decision IN ('Hold','Remeasure','Failed','SyntheticReviewed')),
 criteria_version text NOT NULL CHECK(criteria_version='QC3-WI-BM19-8-40-UNAPPROVED-OD31-v1'),reason text NOT NULL CHECK(length(trim(reason))>=8),
 actor_id uuid NOT NULL REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE p4c_handoff(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),dnb_id uuid NOT NULL REFERENCES p4c_dnb_attempt,revision integer NOT NULL CHECK(revision>0),
 source_sha256 text NOT NULL CHECK(source_sha256~'^[a-f0-9]{64}$'),payload jsonb NOT NULL,
 sha256 text NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'),file_sha256 text CHECK(file_sha256~'^[a-f0-9]{64}$'),
 mapping_status text NOT NULL CHECK(mapping_status IN ('MAPPING_UNAVAILABLE','synthetic-fixture-unverified')),
 created_by uuid NOT NULL REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(dnb_id,revision),
 CHECK(payload->>'vendorCompatible'='false' AND payload->>'purpose'='SYNTHETIC_SIMULATION')
);
CREATE TABLE p4c_handoff_transfer(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 handoff_id uuid NOT NULL REFERENCES p4c_handoff,file_sha256 text NOT NULL CHECK(file_sha256~'^[a-f0-9]{64}$'),
 status text NOT NULL CHECK(status IN ('Complete','Incomplete','Failed')),evidence_hash text NOT NULL CHECK(evidence_hash~'^[a-f0-9]{64}$'),
 evidence_reference text NOT NULL,actor_id uuid NOT NULL REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE p4c_handoff_verification(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),transfer_id uuid NOT NULL UNIQUE REFERENCES p4c_handoff_transfer,
 result text NOT NULL CHECK(result IN ('MATCH','MISMATCH')),observed jsonb NOT NULL,errors jsonb NOT NULL,
 evidence_hash text NOT NULL CHECK(evidence_hash~'^[a-f0-9]{64}$'),reviewer_id uuid NOT NULL REFERENCES app_user,note text NOT NULL CHECK(length(trim(note))>=8),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE p4c_sequencing_attempt(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),dnb_id uuid NOT NULL REFERENCES p4c_dnb_attempt,attempt_number integer NOT NULL CHECK(attempt_number>0),
 supersedes_id uuid UNIQUE REFERENCES p4c_sequencing_attempt,record jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(dnb_id,attempt_number),
 CHECK(record->>'purpose'='SYNTHETIC_SIMULATION' AND record->>'equipmentModel'='DNBSEQ-G50')
);
CREATE TABLE p4c_qc4_observation(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,sequencing_id uuid NOT NULL REFERENCES p4c_sequencing_attempt,
 scope text NOT NULL CHECK(scope IN ('LANE','SAMPLE')),member_key text,lane text NOT NULL CHECK(lane='L01'),metrics jsonb NOT NULL,
 source text NOT NULL CHECK(source IN ('DIRECT_ENTRY','PAPER_TRANSCRIPTION')),copy_id uuid,
 event_time timestamptz,event_precision text NOT NULL CHECK(event_precision IN ('MINUTE','DAY','NOT_RECORDED')),
 evidence_hash text NOT NULL CHECK(evidence_hash~'^[a-f0-9]{64}$'),supersedes_id uuid UNIQUE REFERENCES p4c_qc4_observation,reason text,
 recorded_by uuid NOT NULL REFERENCES app_user,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((scope='SAMPLE')=(member_key IS NOT NULL)),CHECK((source='PAPER_TRANSCRIPTION')=(copy_id IS NOT NULL)),
 CHECK((event_time IS NULL)=(event_precision='NOT_RECORDED')),CHECK(event_time IS NULL OR event_time<=recorded_at),
 CHECK(supersedes_id IS NULL OR length(trim(reason))>=8)
);
CREATE TABLE p4c_qc4_review(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),qc4_id uuid NOT NULL UNIQUE REFERENCES p4c_qc4_observation,
 result text NOT NULL CHECK(result IN ('SyntheticReviewed','Hold','Failed')),
 criteria_version text NOT NULL CHECK(criteria_version='QC4-WI-BM20-21-UNAPPROVED-OD31-v1'),note text NOT NULL CHECK(length(trim(note))>=8),
 reviewer_id uuid NOT NULL REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE p4c_command(
 request_id uuid PRIMARY KEY,dnb_id uuid NOT NULL REFERENCES p4c_dnb_attempt,actor_id uuid NOT NULL REFERENCES app_user,
 input_sha256 text NOT NULL CHECK(input_sha256~'^[a-f0-9]{64}$'),result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['p4c_dnb_attempt','p4c_dnb_event','p4c_dnb_observation','p4c_dnb_review','p4c_qc3_decision','p4c_handoff','p4c_handoff_transfer','p4c_handoff_verification','p4c_sequencing_attempt','p4c_qc4_observation','p4c_qc4_review','p4c_command'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION immutable_row()',t||'_immutable',t);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',t);
 END LOOP;
END $$;
CREATE FUNCTION p4c_pool_current(did uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS(SELECT 1 FROM p4b_pool_event e JOIN p4b_pool_snapshot s ON s.pool_id=e.pool_id JOIN p4c_dnb_attempt d ON d.pool_snapshot_id=s.id
 WHERE d.id=did AND e.event_type IN ('STOP_USE','SUPERSEDED','HOLD'))
 AND NOT EXISTS(SELECT 1 FROM p4c_dnb_event WHERE dnb_id=did AND event_type IN ('STOP_USE','SUPERSEDED','HOLD'))
 AND EXISTS(SELECT 1 FROM p4c_dnb_attempt d JOIN lab_batch b ON b.id=d.batch_id WHERE d.id=did AND b.state<>'Cancelled');
$$;
CREATE FUNCTION p4c_attempt_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE s p4b_pool_snapshot; prior p4c_dnb_attempt; BEGIN
 PERFORM id FROM lab_batch WHERE id=NEW.batch_id FOR UPDATE;
 SELECT * INTO s FROM p4b_pool_snapshot WHERE id=NEW.pool_snapshot_id;
 IF s.id IS NULL OR NOT EXISTS(SELECT 1 FROM p4b_pool_attempt p WHERE p.id=s.pool_id AND p.batch_id=NEW.batch_id)
 OR s.payload->>'acceptance'<>'HOLD' OR s.payload->>'exportAllowed'<>'false'
 OR NOT EXISTS(SELECT 1 FROM p4b_pool_event WHERE pool_id=s.pool_id AND event_type='COMPLETED')
 OR EXISTS(SELECT 1 FROM p4b_pool_event WHERE pool_id=s.pool_id AND event_type IN ('STOP_USE','SUPERSEDED','HOLD'))
 THEN RAISE EXCEPTION 'COMPLETED_CURRENT_HOLD_POOL_REQUIRED'; END IF;
 SELECT * INTO prior FROM p4c_dnb_attempt WHERE batch_id=NEW.batch_id ORDER BY attempt_number DESC LIMIT 1;
 IF NEW.attempt_number<>COALESCE(prior.attempt_number,0)+1 OR NEW.supersedes_id IS DISTINCT FROM prior.id THEN RAISE EXCEPTION 'DNB_ATTEMPT_LINEAGE'; END IF;
 IF prior.id IS NOT NULL AND p4c_pool_current(prior.id) THEN RAISE EXCEPTION 'ACTIVE_DNB_EXISTS'; END IF;
 IF NEW.actual_date<>(clock_timestamp() AT TIME ZONE 'Asia/Bangkok')::date THEN RAISE EXCEPTION 'ACTUAL_DNB_DATE_REQUIRED'; END IF;
 IF NEW.preparation->>'operatorId'<>NEW.created_by::text THEN RAISE EXCEPTION 'ACTUAL_OPERATOR_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER p4c_attempt_guard BEFORE INSERT ON p4c_dnb_attempt FOR EACH ROW EXECUTE FUNCTION p4c_attempt_guard();
CREATE FUNCTION p4c_invalidate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 IF NEW.event_type IN ('STOP_USE','SUPERSEDED','HOLD') THEN
 INSERT INTO p4c_dnb_event(dnb_id,event_type,payload,actor_id)
 SELECT d.id,'STOP_USE',jsonb_build_object('reason','POOL_INVALIDATED','poolEventId',NEW.id,'systemGenerated',true),NULL
 FROM p4c_dnb_attempt d JOIN p4b_pool_snapshot s ON s.id=d.pool_snapshot_id WHERE s.pool_id=NEW.pool_id
 AND NOT EXISTS(SELECT 1 FROM p4c_dnb_event WHERE dnb_id=d.id AND event_type='STOP_USE');
 END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION p4c_invalidate() FROM PUBLIC;
CREATE TRIGGER p4c_pool_invalidated AFTER INSERT ON p4b_pool_event FOR EACH ROW EXECUTE FUNCTION p4c_invalidate();
CREATE FUNCTION p4c_paper_usable(did uuid,cid uuid) RETURNS boolean LANGUAGE plpgsql AS $$ DECLARE usable boolean; BEGIN
 IF cid IS NULL OR to_regclass('public.p4c_document_copy') IS NULL THEN RETURN false; END IF;
 EXECUTE 'SELECT EXISTS(SELECT 1 FROM p4c_document_copy c JOIN p4c_document d ON d.id=c.document_id WHERE c.id=$1 AND d.dnb_id=$2 AND c.kind=''WORKING_COPY'' AND NOT EXISTS(SELECT 1 FROM p4c_dnb_event e WHERE e.dnb_id=$2 AND e.event_type=''RECALL'' AND e.payload->>''copyId''=c.id::text))' INTO usable USING cid,did;
 RETURN usable;
END $$;
CREATE FUNCTION p4c_observation_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE anchor timestamptz; old p4c_dnb_observation; BEGIN
 PERFORM b.id FROM lab_batch b JOIN p4c_dnb_attempt d ON d.batch_id=b.id WHERE d.id=NEW.dnb_id FOR UPDATE OF b;
 IF NOT p4c_pool_current(NEW.dnb_id) THEN RAISE EXCEPTION 'DNB_STOP_USE'; END IF;
 IF EXISTS(SELECT 1 FROM p4c_dnb_event WHERE dnb_id=NEW.dnb_id AND event_type='COMPLETED') THEN RAISE EXCEPTION 'DNB_COMPLETED_IMMUTABLE'; END IF;
 SELECT created_at INTO anchor FROM p4c_dnb_event WHERE dnb_id=NEW.dnb_id AND event_type='DNB_END';
 IF anchor IS NULL THEN RAISE EXCEPTION 'DNB_PRODUCT_REQUIRED'; END IF;
 IF NEW.event_time IS NOT NULL AND NEW.event_time<anchor THEN RAISE EXCEPTION 'EVENT_BEFORE_EXECUTION_ANCHOR'; END IF;
 IF NEW.source='PAPER_TRANSCRIPTION' AND (NOT p4c_paper_usable(NEW.dnb_id,NEW.copy_id) OR NEW.paper_operator IS NULL OR NEW.paper_evidence_hash IS NULL) THEN RAISE EXCEPTION 'WORKING_COPY_NOT_USABLE'; END IF;
 SELECT * INTO old FROM p4c_dnb_observation o WHERE dnb_id=NEW.dnb_id AND field=NEW.field AND NOT EXISTS(SELECT 1 FROM p4c_dnb_observation x WHERE x.supersedes_id=o.id);
 IF NEW.supersedes_id IS DISTINCT FROM old.id THEN RAISE EXCEPTION 'OBSERVATION_REQUIRES_EXACT_SUPERSESSION'; END IF;
 IF EXISTS(SELECT 1 FROM p4c_handoff WHERE dnb_id=NEW.dnb_id) THEN RAISE EXCEPTION 'HANDOFF_FROZEN_NEW_DNB_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER p4c_observation_guard BEFORE INSERT ON p4c_dnb_observation FOR EACH ROW EXECUTE FUNCTION p4c_observation_guard();
CREATE FUNCTION p4c_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE o p4c_dnb_observation; BEGIN
 SELECT * INTO o FROM p4c_dnb_observation WHERE id=NEW.observation_id;
 IF o.recorded_by=NEW.reviewer_id THEN RAISE EXCEPTION 'SECOND_PERSON_REQUIRED'; END IF;
 IF NOT p4c_pool_current(o.dnb_id) OR EXISTS(SELECT 1 FROM p4c_dnb_observation WHERE supersedes_id=o.id) THEN RAISE EXCEPTION 'OBSERVATION_NOT_CURRENT'; END IF;
 IF NEW.result='Confirmed' AND o.event_time IS NULL THEN RAISE EXCEPTION 'UNKNOWN_EVENT_TIME_DISCREPANCY'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER p4c_review_guard BEFORE INSERT ON p4c_dnb_review FOR EACH ROW EXECUTE FUNCTION p4c_review_guard();
CREATE FUNCTION p4c_qc3_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT p4c_pool_current(NEW.dnb_id) OR NOT EXISTS(SELECT 1 FROM p4c_dnb_observation o JOIN p4c_dnb_review r ON r.observation_id=o.id
 WHERE o.id=NEW.observation_id AND o.dnb_id=NEW.dnb_id AND o.field='QC3' AND o.recorded_by<>NEW.actor_id AND r.result='Confirmed'
 AND NOT EXISTS(SELECT 1 FROM p4c_dnb_observation x WHERE x.supersedes_id=o.id)) THEN RAISE EXCEPTION 'QC3_VERIFIED_EVIDENCE_REQUIRED'; END IF;
 IF (SELECT count(DISTINCT o.field) FROM p4c_dnb_observation o JOIN p4c_dnb_review r ON r.observation_id=o.id WHERE o.dnb_id=NEW.dnb_id AND r.result='Confirmed' AND NOT EXISTS(SELECT 1 FROM p4c_dnb_observation x WHERE x.supersedes_id=o.id))<>3 THEN RAISE EXCEPTION 'QC3_STANDARDS_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM p4c_handoff WHERE dnb_id=NEW.dnb_id) THEN RAISE EXCEPTION 'HANDOFF_FROZEN_NEW_DNB_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM p4c_qc3_decision WHERE dnb_id=NEW.dnb_id AND decision='Remeasure' AND observation_id=NEW.observation_id) THEN RAISE EXCEPTION 'QC3_REMEASUREMENT_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER p4c_qc3_guard BEFORE INSERT ON p4c_qc3_decision FOR EACH ROW EXECUTE FUNCTION p4c_qc3_guard();
CREATE FUNCTION p4c_qc3_ready(did uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT p4c_pool_current(did) AND EXISTS(SELECT 1 FROM p4c_qc3_decision q JOIN p4c_dnb_observation o ON o.id=q.observation_id
 WHERE q.dnb_id=did AND q.sequence=(SELECT max(sequence) FROM p4c_qc3_decision WHERE dnb_id=did) AND q.decision='SyntheticReviewed'
 AND NOT EXISTS(SELECT 1 FROM p4c_dnb_observation x WHERE x.supersedes_id=o.id))
 AND 3=(SELECT count(DISTINCT o.field) FROM p4c_dnb_observation o JOIN p4c_dnb_review r ON r.observation_id=o.id WHERE o.dnb_id=did
 AND r.result='Confirmed' AND o.event_time IS NOT NULL AND NOT EXISTS(SELECT 1 FROM p4c_dnb_observation x WHERE x.supersedes_id=o.id));
$$;
CREATE FUNCTION p4c_handoff_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE d p4c_dnb_attempt; s p4b_pool_snapshot; supplied jsonb; src jsonb; BEGIN
 SELECT * INTO d FROM p4c_dnb_attempt WHERE id=NEW.dnb_id; PERFORM id FROM lab_batch WHERE id=d.batch_id FOR UPDATE;
 SELECT * INTO s FROM p4b_pool_snapshot WHERE id=d.pool_snapshot_id;
 IF NOT p4c_qc3_ready(d.id) THEN RAISE EXCEPTION 'QC3_SYNTHETIC_REVIEW_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM p4c_dnb_event WHERE dnb_id=d.id AND event_type='SEQUENCE_START') THEN RAISE EXCEPTION 'SEQUENCE_STARTED_HANDOFF_FROZEN'; END IF;
 IF NEW.revision<>(SELECT COALESCE(max(revision),0)+1 FROM p4c_handoff WHERE dnb_id=d.id) THEN RAISE EXCEPTION 'HANDOFF_REVISION_CONFLICT'; END IF;
 IF NEW.payload->>'poolSnapshotId' IS DISTINCT FROM s.id::text OR NEW.payload->>'poolSnapshotHash' IS DISTINCT FROM s.sha256
 OR NEW.payload->>'dnbLabel' IS DISTINCT FROM d.dnb_label OR NEW.payload->'placements' IS DISTINCT FROM s.payload->'placements'
 THEN RAISE EXCEPTION 'HANDOFF_SOURCE_MISMATCH'; END IF;
 IF NEW.mapping_status='MAPPING_UNAVAILABLE' THEN
 IF NEW.file_sha256 IS NOT NULL OR NEW.payload->'mappedMembers'<>'[]'::jsonb OR NEW.payload->'cellPlan'<>'null'::jsonb THEN RAISE EXCEPTION 'UNAVAILABLE_MAPPING_NO_FILE'; END IF;
 ELSE
 IF jsonb_array_length(s.payload->'members')<>47 OR jsonb_array_length(NEW.payload->'mappedMembers')<>47 OR NEW.file_sha256 IS NULL THEN RAISE EXCEPTION 'MAPPING_UNAVAILABLE_PARTIAL_SOURCE'; END IF;
 IF NEW.payload->'cellPlan'->>'range'<>'A1:E48' OR NEW.payload->'cellPlan'->>'sheet'<>'Sheet1' OR jsonb_array_length(NEW.payload->'cellPlan'->'rows')<>47 THEN RAISE EXCEPTION 'HALOS_CONTRACT_MISMATCH'; END IF;
 IF (SELECT count(DISTINCT m->>'memberKey') FROM jsonb_array_elements(NEW.payload->'mappedMembers') m)<>47
 OR (SELECT count(DISTINCT m->>'physicalPosition') FROM jsonb_array_elements(NEW.payload->'mappedMembers') m)<>47
 OR (SELECT count(DISTINCT m->>'exportSampleId') FROM jsonb_array_elements(NEW.payload->'mappedMembers') m)<>47
 OR (SELECT count(DISTINCT m->>'printedSampleId') FROM jsonb_array_elements(NEW.payload->'mappedMembers') m)<>47
 OR (SELECT count(DISTINCT m->>'lnHalos') FROM jsonb_array_elements(NEW.payload->'mappedMembers') m)<>47
 OR (SELECT count(DISTINCT m->>'barcodeIndex') FROM jsonb_array_elements(NEW.payload->'mappedMembers') m)<>47
 THEN RAISE EXCEPTION 'DUPLICATE_HANDOFF_MEMBER'; END IF;
 IF (SELECT jsonb_agg(m->'barcodeIndex' ORDER BY ord) FROM jsonb_array_elements(NEW.payload->'mappedMembers') WITH ORDINALITY AS j(m,ord))<>'[1,2,3,4,5,6,7,8,9,10,11,12,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48]'::jsonb THEN RAISE EXCEPTION 'HALOS_BARCODE_ORDER_MISMATCH'; END IF;
 FOR supplied IN SELECT * FROM jsonb_array_elements(NEW.payload->'mappedMembers') LOOP
 SELECT x INTO src FROM jsonb_array_elements(s.payload->'members') x WHERE (x->>'slot')::int=(supplied->>'physicalPosition')::int;
 IF src IS NULL OR supplied->>'physicalPosition'='40' OR supplied->>'role' IS DISTINCT FROM src->>'kind'
 OR supplied->>'printedSampleId' IS DISTINCT FROM COALESCE(src->>'printedSampleId',src->>'printedControlId')
 OR (supplied->>'role'='PATIENT' AND (supplied->>'lnHalos' IS DISTINCT FROM src->>'lnHalos' OR supplied->>'memberKey' IS DISTINCT FROM src->>'attemptId'))
 OR (supplied->>'role'<>'PATIENT' AND supplied->>'memberKey' IS DISTINCT FROM (src->>'kind')||':'||(src->>'slot'))
 THEN RAISE EXCEPTION 'MAPPING_SOURCE_IDENTITY_MISMATCH'; END IF;
 END LOOP;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER p4c_handoff_guard BEFORE INSERT ON p4c_handoff FOR EACH ROW EXECUTE FUNCTION p4c_handoff_guard();
CREATE FUNCTION p4c_sequence_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE old p4c_sequencing_attempt; BEGIN
 PERFORM b.id FROM lab_batch b JOIN p4c_dnb_attempt d ON d.batch_id=b.id WHERE d.id=NEW.dnb_id FOR UPDATE OF b;
 IF NOT p4c_qc3_ready(NEW.dnb_id) THEN RAISE EXCEPTION 'QC3_SYNTHETIC_REVIEW_REQUIRED'; END IF;
 SELECT * INTO old FROM p4c_sequencing_attempt WHERE dnb_id=NEW.dnb_id ORDER BY attempt_number DESC LIMIT 1;
 IF NEW.attempt_number<>COALESCE(old.attempt_number,0)+1 OR NEW.supersedes_id IS DISTINCT FROM old.id THEN RAISE EXCEPTION 'SEQUENCE_ATTEMPT_LINEAGE'; END IF;
 IF old.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM p4c_dnb_event WHERE dnb_id=NEW.dnb_id AND event_type='SEQUENCE_HOLD' AND payload->>'sequencingId'=old.id::text) THEN RAISE EXCEPTION 'ACTIVE_SEQUENCING_ATTEMPT'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER p4c_sequence_guard BEFORE INSERT ON p4c_sequencing_attempt FOR EACH ROW EXECUTE FUNCTION p4c_sequence_guard();
CREATE FUNCTION p4c_transfer_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE h p4c_handoff; BEGIN
 SELECT * INTO h FROM p4c_handoff WHERE id=NEW.handoff_id;
 PERFORM b.id FROM lab_batch b JOIN p4c_dnb_attempt d ON d.batch_id=b.id WHERE d.id=h.dnb_id FOR UPDATE OF b;
 IF NOT p4c_pool_current(h.dnb_id) OR h.mapping_status<>'synthetic-fixture-unverified' OR NEW.file_sha256 IS DISTINCT FROM h.file_sha256 THEN RAISE EXCEPTION 'HANDOFF_NOT_TRANSFERABLE'; END IF;
 IF h.revision<>(SELECT max(revision) FROM p4c_handoff WHERE dnb_id=h.dnb_id) THEN RAISE EXCEPTION 'HANDOFF_SUPERSEDED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER p4c_transfer_guard BEFORE INSERT ON p4c_handoff_transfer FOR EACH ROW EXECUTE FUNCTION p4c_transfer_guard();
CREATE FUNCTION p4c_verification_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE t p4c_handoff_transfer; h p4c_handoff; BEGIN
 SELECT * INTO t FROM p4c_handoff_transfer WHERE id=NEW.transfer_id; SELECT * INTO h FROM p4c_handoff WHERE id=t.handoff_id;
 PERFORM b.id FROM lab_batch b JOIN p4c_dnb_attempt d ON d.batch_id=b.id WHERE d.id=h.dnb_id FOR UPDATE OF b;
 IF t.actor_id=NEW.reviewer_id THEN RAISE EXCEPTION 'SECOND_PERSON_REQUIRED'; END IF;
 IF NOT p4c_pool_current(h.dnb_id) OR t.sequence<>(SELECT max(sequence) FROM p4c_handoff_transfer WHERE handoff_id=t.handoff_id) THEN RAISE EXCEPTION 'TRANSFER_NOT_CURRENT'; END IF;
 IF NEW.result='MATCH' AND (t.status<>'Complete' OR NEW.errors<>'[]'::jsonb OR NEW.observed->>'status'<>'Complete'
 OR NEW.observed->>'fileHash' IS DISTINCT FROM h.file_sha256 OR NEW.observed->'observedRows' IS DISTINCT FROM h.payload->'mappedMembers'
 OR NEW.observed->>'observedDnbId' IS DISTINCT FROM h.payload->>'dnbLabel' OR NEW.observed->>'lane'<>'L01') THEN RAISE EXCEPTION 'HANDOFF_EXACT_MATCH_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER p4c_verification_guard BEFORE INSERT ON p4c_handoff_verification FOR EACH ROW EXECUTE FUNCTION p4c_verification_guard();
CREATE FUNCTION p4c_handoff_verified(did uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT p4c_pool_current(did) AND EXISTS(SELECT 1 FROM p4c_handoff h JOIN p4c_handoff_transfer t ON t.handoff_id=h.id JOIN p4c_handoff_verification v ON v.transfer_id=t.id
 WHERE h.dnb_id=did AND h.mapping_status='synthetic-fixture-unverified' AND h.revision=(SELECT max(revision) FROM p4c_handoff WHERE dnb_id=did)
 AND t.sequence=(SELECT max(sequence) FROM p4c_handoff_transfer WHERE handoff_id=h.id) AND t.status='Complete' AND v.result='MATCH');
$$;
CREATE FUNCTION p4c_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE sid uuid; BEGIN
 PERFORM b.id FROM lab_batch b JOIN p4c_dnb_attempt d ON d.batch_id=b.id WHERE d.id=NEW.dnb_id FOR UPDATE OF b;
 IF NEW.event_type IN ('STOP_USE','RECALL','SUPERSEDED','PREVIEW') THEN RETURN NEW; END IF;
 IF NOT p4c_pool_current(NEW.dnb_id) THEN RAISE EXCEPTION 'DNB_STOP_USE'; END IF;
 IF NEW.event_type='DNB_START' AND (EXISTS(SELECT 1 FROM p4c_dnb_event WHERE dnb_id=NEW.dnb_id AND event_type='DNB_START') OR NOT EXISTS(SELECT 1 FROM p4c_dnb_event WHERE dnb_id=NEW.dnb_id AND event_type='PRE_WORK')) THEN RAISE EXCEPTION 'SYNTHETIC_PRE_WORK_REQUIRED'; END IF;
 IF NEW.event_type='DNB_END' AND (NOT EXISTS(SELECT 1 FROM p4c_dnb_event WHERE dnb_id=NEW.dnb_id AND event_type='DNB_START') OR EXISTS(SELECT 1 FROM p4c_dnb_event WHERE dnb_id=NEW.dnb_id AND event_type='DNB_END')) THEN RAISE EXCEPTION 'DNB_NOT_IN_EXECUTION'; END IF;
 IF NEW.event_type IN ('SEQUENCE_START','SEQUENCE_END','ANALYSIS_COMPLETE') THEN
 sid:=(NEW.payload->>'sequencingId')::uuid;
 IF NOT EXISTS(SELECT 1 FROM p4c_sequencing_attempt WHERE id=sid AND dnb_id=NEW.dnb_id) THEN RAISE EXCEPTION 'SEQUENCE_SCOPE_MISMATCH'; END IF;
 IF sid IS DISTINCT FROM (SELECT id FROM p4c_sequencing_attempt WHERE dnb_id=NEW.dnb_id ORDER BY attempt_number DESC LIMIT 1) THEN RAISE EXCEPTION 'SEQUENCE_NOT_CURRENT'; END IF;
 IF EXISTS(SELECT 1 FROM p4c_dnb_event WHERE dnb_id=NEW.dnb_id AND event_type='SEQUENCE_HOLD' AND payload->>'sequencingId'=sid::text) THEN RAISE EXCEPTION 'SEQUENCE_ON_HOLD'; END IF;
 IF NEW.event_type IN ('SEQUENCE_START','ANALYSIS_COMPLETE') AND NOT p4c_handoff_verified(NEW.dnb_id) THEN RAISE EXCEPTION 'HANDOFF_VERIFICATION_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM p4c_dnb_event WHERE dnb_id=NEW.dnb_id AND event_type=NEW.event_type AND payload->>'sequencingId'=sid::text) THEN RAISE EXCEPTION 'SEQUENCE_TRANSITION_ALREADY_RECORDED'; END IF;
 IF NEW.event_type<>'SEQUENCE_START' AND NOT EXISTS(SELECT 1 FROM p4c_dnb_event WHERE dnb_id=NEW.dnb_id AND event_type='SEQUENCE_START' AND payload->>'sequencingId'=sid::text) THEN RAISE EXCEPTION 'SEQUENCE_START_REQUIRED'; END IF;
 IF NEW.event_type='ANALYSIS_COMPLETE' AND NOT EXISTS(SELECT 1 FROM p4c_dnb_event WHERE dnb_id=NEW.dnb_id AND event_type='SEQUENCE_END' AND payload->>'sequencingId'=sid::text) THEN RAISE EXCEPTION 'SEQUENCE_END_REQUIRED'; END IF;
 IF NEW.event_type='SEQUENCE_START' AND NOT p4c_qc3_ready(NEW.dnb_id) THEN RAISE EXCEPTION 'QC3_SYNTHETIC_REVIEW_REQUIRED'; END IF;
 IF NEW.event_type='SEQUENCE_END' AND (NEW.payload->'firstCycle' IS NULL OR NEW.payload->>'postWash' IS DISTINCT FROM 'true') THEN RAISE EXCEPTION 'FIRST_CYCLE_AND_POST_WASH_REQUIRED'; END IF;
 IF NEW.event_type='ANALYSIS_COMPLETE' THEN
 IF NOT EXISTS(SELECT 1 FROM p4c_qc4_observation o JOIN p4c_qc4_review r ON r.qc4_id=o.id WHERE o.sequencing_id=sid AND o.scope='LANE' AND r.result='SyntheticReviewed' AND o.event_time IS NOT NULL AND NOT EXISTS(SELECT 1 FROM p4c_qc4_observation x WHERE x.supersedes_id=o.id))
 OR EXISTS(SELECT 1 FROM p4c_handoff h,jsonb_array_elements(h.payload->'mappedMembers') m WHERE h.dnb_id=NEW.dnb_id AND h.revision=(SELECT max(revision) FROM p4c_handoff WHERE dnb_id=NEW.dnb_id)
 AND NOT EXISTS(SELECT 1 FROM p4c_qc4_observation o JOIN p4c_qc4_review r ON r.qc4_id=o.id WHERE o.sequencing_id=sid AND o.scope='SAMPLE' AND o.member_key=m->>'memberKey' AND r.result='SyntheticReviewed' AND o.event_time IS NOT NULL AND NOT EXISTS(SELECT 1 FROM p4c_qc4_observation x WHERE x.supersedes_id=o.id)))
 THEN RAISE EXCEPTION 'QC4_SYNTHETIC_REVIEW_REQUIRED'; END IF;
 END IF;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER p4c_event_guard BEFORE INSERT ON p4c_dnb_event FOR EACH ROW EXECUTE FUNCTION p4c_event_guard();
CREATE FUNCTION p4c_qc4_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE did uuid; old p4c_qc4_observation; anchor timestamptz; BEGIN
 SELECT dnb_id INTO did FROM p4c_sequencing_attempt WHERE id=NEW.sequencing_id;
 PERFORM b.id FROM lab_batch b JOIN p4c_dnb_attempt d ON d.batch_id=b.id WHERE d.id=did FOR UPDATE OF b;
 IF NOT p4c_pool_current(did) OR EXISTS(SELECT 1 FROM p4c_dnb_event WHERE dnb_id=did AND event_type IN ('COMPLETED','ANALYSIS_COMPLETE')) THEN RAISE EXCEPTION 'QC4_NOT_CURRENT'; END IF;
 SELECT created_at INTO anchor FROM p4c_dnb_event WHERE dnb_id=did AND event_type='SEQUENCE_END' AND payload->>'sequencingId'=NEW.sequencing_id::text;
 IF anchor IS NULL THEN RAISE EXCEPTION 'SEQUENCE_END_REQUIRED'; END IF;
 IF NEW.event_time IS NOT NULL AND NEW.event_time<anchor THEN RAISE EXCEPTION 'EVENT_BEFORE_EXECUTION_ANCHOR'; END IF;
 IF NEW.source='PAPER_TRANSCRIPTION' AND NOT p4c_paper_usable(did,NEW.copy_id) THEN RAISE EXCEPTION 'WORKING_COPY_NOT_USABLE'; END IF;
 IF NEW.scope='SAMPLE' AND NOT EXISTS(SELECT 1 FROM p4c_handoff h,jsonb_array_elements(h.payload->'mappedMembers') m WHERE h.dnb_id=did AND m->>'memberKey'=NEW.member_key) THEN RAISE EXCEPTION 'QC4_MEMBER_SCOPE'; END IF;
 SELECT * INTO old FROM p4c_qc4_observation o WHERE sequencing_id=NEW.sequencing_id AND scope=NEW.scope AND member_key IS NOT DISTINCT FROM NEW.member_key AND NOT EXISTS(SELECT 1 FROM p4c_qc4_observation x WHERE x.supersedes_id=o.id);
 IF NEW.supersedes_id IS DISTINCT FROM old.id THEN RAISE EXCEPTION 'OBSERVATION_REQUIRES_EXACT_SUPERSESSION'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER p4c_qc4_guard BEFORE INSERT ON p4c_qc4_observation FOR EACH ROW EXECUTE FUNCTION p4c_qc4_guard();
CREATE FUNCTION p4c_qc4_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE o p4c_qc4_observation; did uuid; BEGIN
 SELECT * INTO o FROM p4c_qc4_observation WHERE id=NEW.qc4_id; SELECT dnb_id INTO did FROM p4c_sequencing_attempt WHERE id=o.sequencing_id;
 IF NEW.reviewer_id=o.recorded_by THEN RAISE EXCEPTION 'SECOND_PERSON_REQUIRED'; END IF;
 IF NOT p4c_pool_current(did) OR EXISTS(SELECT 1 FROM p4c_qc4_observation WHERE supersedes_id=o.id) THEN RAISE EXCEPTION 'QC4_NOT_CURRENT'; END IF;
 IF NEW.result='SyntheticReviewed' AND o.event_time IS NULL THEN RAISE EXCEPTION 'UNKNOWN_EVENT_TIME_DISCREPANCY'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER p4c_qc4_review_guard BEFORE INSERT ON p4c_qc4_review FOR EACH ROW EXECUTE FUNCTION p4c_qc4_review_guard();
