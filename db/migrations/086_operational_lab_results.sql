-- Operational paths require the explicit database marker, current reviewed evidence and role checks.
-- Existing synthetic rows remain immutable; no historical evidence is relabelled.
ALTER TABLE p4b_pool_attempt DROP CONSTRAINT p4b_pool_attempt_payload_check;
ALTER TABLE p4b_pool_attempt DROP CONSTRAINT p4b_attempt_synthetic_hold;
ALTER TABLE p4b_pool_attempt ADD CONSTRAINT p4b_pool_mode CHECK((payload->>'synthetic')::boolean IS DISTINCT FROM nipt_operational_enabled());
ALTER TABLE p4b_pool_event DROP CONSTRAINT p4b_pool_event_event_type_check;
ALTER TABLE p4b_pool_event ADD CONSTRAINT p4b_pool_event_type CHECK(event_type IN ('CROSSCHECK_PASS','CROSSCHECK_FAIL','PREVIEW','PRE_WORK','START','END','COMPLETED','HOLD','STOP_USE','SUPERSEDED','RECALL','ACCEPTED'));
ALTER TABLE p4b_qc2_decision DROP CONSTRAINT p4b_qc2_decision_decision_check;
ALTER TABLE p4b_qc2_decision DROP CONSTRAINT p4b_qc2_decision_criteria_version_check;
ALTER TABLE p4b_qc2_decision ADD CONSTRAINT p4b_qc2_operational_decision CHECK(
 (decision IN ('Hold','Remeasure','Failed','SyntheticReviewed') AND criteria_version='QC2-WI-BM19-UNAPPROVED-OD31-v1') OR
 (nipt_operational_enabled() AND decision='Accepted' AND length(trim(criteria_version))>=8));
ALTER TABLE p4b_pool_snapshot DROP CONSTRAINT p4b_pool_snapshot_payload_check;
ALTER TABLE p4b_pool_snapshot DROP CONSTRAINT p4b_snapshot_synthetic_hold;
ALTER TABLE p4b_pool_snapshot ADD CONSTRAINT p4b_snapshot_acceptance CHECK(payload->>'acceptance'='HOLD' OR
 (nipt_operational_enabled() AND payload->>'acceptance'='Accepted' AND payload->>'synthetic'='false' AND payload->>'exportAllowed'='true'));
CREATE FUNCTION p4b_operational_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE p p4b_pool_attempt; BEGIN
 IF NEW.payload->>'acceptance'<>'Accepted' THEN RETURN NEW; END IF;
 SELECT * INTO p FROM p4b_pool_attempt WHERE id=NEW.pool_id;
 PERFORM id FROM lab_batch WHERE id=p.batch_id FOR UPDATE;
 IF p.payload->>'synthetic'<>'false' OR NOT nipt_operational_enabled()
 OR EXISTS(SELECT 1 FROM p4b_pool_event WHERE pool_id=p.id AND event_type IN ('HOLD','STOP_USE','SUPERSEDED','ACCEPTED'))
 OR NOT EXISTS(SELECT 1 FROM p4b_pool_event WHERE pool_id=p.id AND event_type='END')
 OR NOT EXISTS(SELECT 1 FROM p4b_pool_event WHERE pool_id=p.id AND event_type='CROSSCHECK_PASS')
 OR NOT EXISTS(SELECT 1 FROM p4b_qc2_decision q WHERE pool_id=p.id AND decision='Accepted' AND q.id::text=NEW.payload->'decision'->>'id')
 OR NEW.payload->'members' IS DISTINCT FROM p.payload->'members' OR NEW.payload->'placements' IS DISTINCT FROM p.payload->'placements'
 OR NEW.payload->>'calculationSha256' IS DISTINCT FROM p.sha256
 OR NOT EXISTS(SELECT 1 FROM role_assignment a WHERE a.user_id=NEW.created_by AND a.role='LAB_CERTIFIER' AND a.approved_by IS NOT NULL AND a.effective_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now()))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p.payload->'members') m WHERE NOT EXISTS(SELECT 1 FROM p4b_pool_observation o JOIN p4b_pool_review r ON r.observation_id=o.id WHERE o.pool_id=p.id AND o.field='TRANSFER' AND o.slot=(m->>'slot')::int AND r.result='Confirmed' AND o.event_time IS NOT NULL AND NOT EXISTS(SELECT 1 FROM p4b_pool_observation x WHERE x.supersedes_id=o.id)))
 OR 4<>(SELECT count(DISTINCT o.field) FROM p4b_pool_observation o JOIN p4b_pool_review r ON r.observation_id=o.id WHERE o.pool_id=p.id AND o.field IN ('BUFFER','QC2','STD1','STD2') AND r.result='Confirmed' AND o.event_time IS NOT NULL AND NOT EXISTS(SELECT 1 FROM p4b_pool_observation x WHERE x.supersedes_id=o.id))
 THEN RAISE EXCEPTION 'POOL_ACCEPTANCE_EVIDENCE_REQUIRED'; END IF;
 RETURN NEW;
END $$;

CREATE TABLE p4b_halos_export(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),pool_snapshot_id uuid NOT NULL REFERENCES p4b_pool_snapshot,
 revision integer NOT NULL CHECK(revision>0),dnb_date date NOT NULL,file_sha256 text NOT NULL CHECK(file_sha256 ~ '^[a-f0-9]{64}$'),
 source jsonb NOT NULL,manifest jsonb NOT NULL,created_by uuid NOT NULL REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(pool_snapshot_id,revision),
 CHECK((source->'pool'->>'id'=pool_snapshot_id::text AND source->'dnb'->>'id'='DNB'||to_char(dnb_date,'YYYYMMDD') AND jsonb_array_length(source->'members')=47 AND manifest->>'fileSha256'=file_sha256) IS TRUE)
);
CREATE TABLE p4b_halos_verification(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),export_id uuid NOT NULL UNIQUE REFERENCES p4b_halos_export,observed jsonb NOT NULL,
 evidence_reference text NOT NULL CHECK(length(trim(evidence_reference))>=8),evidence_hash text NOT NULL CHECK(evidence_hash ~ '^[a-f0-9]{64}$'),
 reviewer_id uuid NOT NULL REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER p4b_halos_export_immutable BEFORE UPDATE OR DELETE ON p4b_halos_export FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER p4b_halos_verification_immutable BEFORE UPDATE OR DELETE ON p4b_halos_verification FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE FUNCTION p4b_halos_verification_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE e p4b_halos_export; BEGIN
 SELECT * INTO e FROM p4b_halos_export WHERE id=NEW.export_id;
 IF NOT nipt_operational_enabled() OR NEW.observed->>'fileHash' IS DISTINCT FROM e.file_sha256 OR NEW.observed->>'observedDnbId' IS DISTINCT FROM e.source->'dnb'->>'id'
 OR NEW.observed->'observedRows' IS DISTINCT FROM e.source->'members' OR e.revision<>(SELECT max(revision) FROM p4b_halos_export WHERE pool_snapshot_id=e.pool_snapshot_id)
 THEN RAISE EXCEPTION 'HANDOFF_EXACT_MATCH_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER p4b_halos_verification_guard BEFORE INSERT ON p4b_halos_verification FOR EACH ROW EXECUTE FUNCTION p4b_halos_verification_guard();
REVOKE ALL ON p4b_halos_export,p4b_halos_verification FROM PUBLIC;
CREATE TRIGGER p4b_operational_snapshot_guard BEFORE INSERT ON p4b_pool_snapshot FOR EACH ROW EXECUTE FUNCTION p4b_operational_snapshot_guard();
CREATE FUNCTION p4b_accepted_evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE pid uuid; BEGIN
 pid:=NEW.pool_id;
 IF EXISTS(SELECT 1 FROM p4b_pool_event WHERE pool_id=pid AND event_type='ACCEPTED') THEN RAISE EXCEPTION 'POOL_ACCEPTED_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER p4b_accepted_observation_immutable BEFORE INSERT ON p4b_pool_observation FOR EACH ROW EXECUTE FUNCTION p4b_accepted_evidence_immutable();
CREATE TRIGGER p4b_accepted_qc2_immutable BEFORE INSERT ON p4b_qc2_decision FOR EACH ROW EXECUTE FUNCTION p4b_accepted_evidence_immutable();

ALTER TABLE p4c_dnb_attempt DROP CONSTRAINT p4c_dnb_attempt_purpose_check;
ALTER TABLE p4c_dnb_attempt DROP CONSTRAINT p4c_dnb_attempt_preparation_check;
ALTER TABLE p4c_dnb_attempt DROP CONSTRAINT p4c_dnb_explicit_hold;
ALTER TABLE p4c_dnb_attempt ADD CONSTRAINT p4c_dnb_runtime_contract CHECK(
 (purpose='SYNTHETIC_SIMULATION' AND payload->>'synthetic'='true' AND preparation->>'method'='UNRESOLVED_OD32_WC05') OR
 (nipt_operational_enabled() AND purpose='OPERATIONAL' AND payload->>'synthetic'='false' AND preparation->>'method'='CONTROLLED_PROTOCOL' AND length(preparation->'protocolEvidence'->>'reference')>=8 AND preparation->'protocolEvidence'->>'sha256' ~ '^[a-f0-9]{64}$'));
ALTER TABLE p4c_qc3_decision DROP CONSTRAINT p4c_qc3_decision_decision_check;
ALTER TABLE p4c_qc3_decision DROP CONSTRAINT p4c_qc3_decision_criteria_version_check;
ALTER TABLE p4c_qc3_decision ADD CONSTRAINT p4c_qc3_runtime_decision CHECK(
 (decision IN ('Hold','Remeasure','Failed','SyntheticReviewed') AND criteria_version='QC3-WI-BM19-8-40-UNAPPROVED-OD31-v1') OR
 (nipt_operational_enabled() AND decision='Accepted' AND length(trim(criteria_version))>=8));
ALTER TABLE p4c_qc4_review DROP CONSTRAINT p4c_qc4_review_result_check;
ALTER TABLE p4c_qc4_review DROP CONSTRAINT p4c_qc4_review_criteria_version_check;
ALTER TABLE p4c_qc4_review ADD CONSTRAINT p4c_qc4_runtime_decision CHECK(
 (result IN ('Hold','Failed','SyntheticReviewed') AND criteria_version='QC4-WI-BM20-21-UNAPPROVED-OD31-v1') OR
 (nipt_operational_enabled() AND result='Accepted' AND length(trim(criteria_version))>=8));
ALTER TABLE p4c_sequencing_attempt DROP CONSTRAINT p4c_sequencing_attempt_record_check;
ALTER TABLE p4c_sequencing_attempt DROP CONSTRAINT p4c_sequence_explicit_simulation;
ALTER TABLE p4c_sequencing_attempt ADD CONSTRAINT p4c_sequence_runtime_contract CHECK((record->>'equipmentModel'='DNBSEQ-G50' AND
 (record->>'purpose'='SYNTHETIC_SIMULATION' OR (nipt_operational_enabled() AND record->>'purpose'='OPERATIONAL'))) IS TRUE);
-- Preserve lineage/date/operator enforcement while adding the reviewed Accepted pool branch.
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('p4c_attempt_guard()'::regprocedure) INTO definition;
 definition:=replace(definition,$old$s.payload->>'acceptance'<>'HOLD'$old$,$new$NOT ((NEW.purpose='SYNTHETIC_SIMULATION' AND s.payload->>'acceptance'='HOLD') OR (nipt_operational_enabled() AND NEW.purpose='OPERATIONAL' AND s.payload->>'acceptance'='Accepted' AND s.payload->>'synthetic'='false'))$new$);
 definition:=replace(definition,$old$s.payload->>'exportAllowed'<>'false'$old$,$new$(NEW.purpose='SYNTHETIC_SIMULATION' AND s.payload->>'exportAllowed'<>'false')$new$);
 definition:=replace(definition,$old$NOT EXISTS(SELECT 1 FROM p4b_pool_event WHERE pool_id=s.pool_id AND event_type='COMPLETED')$old$,$new$NOT EXISTS(SELECT 1 FROM p4b_pool_event WHERE pool_id=s.pool_id AND event_type=CASE WHEN NEW.purpose='OPERATIONAL' THEN 'ACCEPTED' ELSE 'COMPLETED' END)$new$);
 EXECUTE definition;
 SELECT pg_get_functiondef('p4c_qc3_ready(uuid)'::regprocedure) INTO definition;
 EXECUTE replace(definition,$old$q.decision='SyntheticReviewed'$old$,$new$(q.decision='SyntheticReviewed' OR (nipt_operational_enabled() AND q.decision='Accepted'))$new$);
END $$;

-- The operational handoff uses the persisted real XLSX and a separate exact observed import review.
DO $$ BEGIN EXECUTE replace(pg_get_functiondef('p4c_handoff_verified(uuid)'::regprocedure),'FUNCTION public.p4c_handoff_verified','FUNCTION public.p4c_synthetic_handoff_verified'); END $$;
CREATE OR REPLACE FUNCTION p4c_handoff_verified(did uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN (SELECT purpose FROM p4c_dnb_attempt WHERE id=did)='OPERATIONAL' THEN
 nipt_operational_enabled() AND p4c_pool_current(did) AND EXISTS(SELECT 1 FROM p4c_dnb_attempt d JOIN p4b_halos_export e ON e.pool_snapshot_id=d.pool_snapshot_id AND e.dnb_date=d.actual_date JOIN p4b_halos_verification v ON v.export_id=e.id WHERE d.id=did AND e.revision=(SELECT max(revision) FROM p4b_halos_export WHERE pool_snapshot_id=e.pool_snapshot_id))
 ELSE p4c_synthetic_handoff_verified(did) END;
$$;
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('p4c_event_guard()'::regprocedure) INTO definition;
 definition:=replace(definition,$old$NOT EXISTS(SELECT 1 FROM p4c_dnb_event WHERE dnb_id=NEW.dnb_id AND event_type='PRE_WORK')$old$,$new$(NOT EXISTS(SELECT 1 FROM p4c_dnb_event WHERE dnb_id=NEW.dnb_id AND event_type='PRE_WORK') AND NOT EXISTS(SELECT 1 FROM p4c_dnb_attempt WHERE id=NEW.dnb_id AND purpose='OPERATIONAL' AND preparation->'protocolEvidence' IS NOT NULL AND nipt_operational_enabled()))$new$);
 definition:=replace(definition,$old$r.result='SyntheticReviewed'$old$,$new$(r.result='SyntheticReviewed' OR (nipt_operational_enabled() AND r.result='Accepted'))$new$);
 EXECUTE definition;
 SELECT pg_get_functiondef('p4c_qc4_guard()'::regprocedure) INTO definition;
 definition:=replace(definition,$old$AND m->>'memberKey'=NEW.member_key)$old$,$new$AND m->>'memberKey'=NEW.member_key) AND NOT EXISTS(SELECT 1 FROM p4c_dnb_attempt d JOIN p4b_halos_export e ON e.pool_snapshot_id=d.pool_snapshot_id,jsonb_array_elements(e.source->'members') m WHERE d.id=did AND e.dnb_date=d.actual_date AND e.revision=(SELECT max(revision) FROM p4b_halos_export WHERE pool_snapshot_id=e.pool_snapshot_id) AND m->>'memberKey'=NEW.member_key)$new$);
 EXECUTE definition;
END $$;
CREATE FUNCTION p4c_operational_analysis_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE sid uuid; did uuid; BEGIN
 did:=NEW.dnb_id;
 IF NEW.event_type<>'ANALYSIS_COMPLETE' OR (SELECT purpose FROM p4c_dnb_attempt WHERE id=did)<>'OPERATIONAL' THEN RETURN NEW; END IF;
 sid:=(NEW.payload->>'sequencingId')::uuid;
 IF NOT nipt_operational_enabled() OR NOT p4c_handoff_verified(did)
 OR EXISTS(SELECT 1 FROM p4c_dnb_attempt d JOIN p4b_halos_export e ON e.pool_snapshot_id=d.pool_snapshot_id,jsonb_array_elements(e.source->'members') m WHERE d.id=did AND e.dnb_date=d.actual_date AND e.revision=(SELECT max(revision) FROM p4b_halos_export WHERE pool_snapshot_id=e.pool_snapshot_id) AND NOT EXISTS(SELECT 1 FROM p4c_qc4_observation o JOIN p4c_qc4_review r ON r.qc4_id=o.id WHERE o.sequencing_id=sid AND o.scope='SAMPLE' AND o.member_key=m->>'memberKey' AND r.result='Accepted' AND o.event_time IS NOT NULL AND NOT EXISTS(SELECT 1 FROM p4c_qc4_observation x WHERE x.supersedes_id=o.id)))
 OR NOT EXISTS(SELECT 1 FROM p4c_qc4_observation o JOIN p4c_qc4_review r ON r.qc4_id=o.id WHERE o.sequencing_id=sid AND o.scope='LANE' AND r.result='Accepted' AND o.event_time IS NOT NULL AND NOT EXISTS(SELECT 1 FROM p4c_qc4_observation x WHERE x.supersedes_id=o.id))
 THEN RAISE EXCEPTION 'OPERATIONAL_QC4_ACCEPTANCE_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER p4c_operational_analysis_guard BEFORE INSERT ON p4c_dnb_event FOR EACH ROW EXECUTE FUNCTION p4c_operational_analysis_guard();

CREATE TABLE result_qc5_review(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),version_id uuid NOT NULL UNIQUE REFERENCES result_report_version,
 attempt_id uuid NOT NULL REFERENCES analytical_attempt,pool_id uuid NOT NULL REFERENCES p4b_pool_attempt,dnb_id uuid NOT NULL REFERENCES p4c_dnb_attempt,sequencing_id uuid NOT NULL REFERENCES p4c_sequencing_attempt,
 report_sha256 text NOT NULL CHECK(report_sha256 ~ '^[a-f0-9]{64}$'),source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),review_id uuid NOT NULL REFERENCES result_review,
 criteria_reference text NOT NULL CHECK(length(trim(criteria_reference))>=8),reason text NOT NULL CHECK(length(trim(reason))>=8),reviewer_id uuid NOT NULL REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER result_qc5_immutable BEFORE UPDATE OR DELETE ON result_qc5_review FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE FUNCTION p5_qc5_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT nipt_operational_enabled() OR NOT EXISTS(SELECT 1 FROM role_assignment a WHERE a.user_id=NEW.reviewer_id AND a.role='LAB_CERTIFIER' AND a.approved_by IS NOT NULL AND a.effective_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now()))
 OR NOT EXISTS(SELECT 1 FROM result_report_version v JOIN result_review r ON r.version_id=v.id JOIN analytical_attempt a ON a.id=v.attempt_id JOIN nipt_case c ON c.id=v.case_id JOIN p4c_dnb_attempt d ON d.id=NEW.dnb_id JOIN p4b_pool_snapshot p ON p.id=d.pool_snapshot_id JOIN p4c_sequencing_attempt s ON s.dnb_id=d.id WHERE v.id=NEW.version_id AND v.attempt_id=NEW.attempt_id AND v.sha256=NEW.report_sha256 AND NOT v.synthetic AND v.state IN ('Linked','ValidationBlocked','PendingCertification') AND r.id=NEW.review_id AND r.values_match_pdf AND p.pool_id=NEW.pool_id AND d.purpose='OPERATIONAL' AND p.payload->>'acceptance'='Accepted' AND s.id=NEW.sequencing_id AND c.current_round_id=v.round_id AND s.id=(SELECT id FROM p4c_sequencing_attempt WHERE dnb_id=d.id ORDER BY attempt_number DESC LIMIT 1) AND p4c_pool_current(d.id) AND p4c_handoff_verified(d.id))
 OR NOT EXISTS(SELECT 1 FROM p4c_dnb_event WHERE dnb_id=NEW.dnb_id AND event_type='ANALYSIS_COMPLETE' AND payload->>'sequencingId'=NEW.sequencing_id::text)
 THEN RAISE EXCEPTION 'QC5_ACCEPTED_CURRENT_EVIDENCE_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER p5_qc5_guard BEFORE INSERT ON result_qc5_review FOR EACH ROW EXECUTE FUNCTION p5_qc5_guard();
-- A clinical attempt can advance only using a reviewed report receipt against its current accepted sequence.
CREATE OR REPLACE FUNCTION p7_closed_clinical_state_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.state IN ('AnalysisComplete','FinalQcAccepted','Final') AND (TG_OP='INSERT' OR NEW.state IS DISTINCT FROM OLD.state) THEN
 IF NOT nipt_operational_enabled() OR TG_OP='INSERT' OR NOT EXISTS(SELECT 1 FROM result_qc5_review q JOIN p4c_dnb_attempt d ON d.id=q.dnb_id WHERE q.attempt_id=NEW.id AND p4c_pool_current(d.id) AND p4c_handoff_verified(d.id) AND q.sequencing_id=(SELECT id FROM p4c_sequencing_attempt WHERE dnb_id=d.id ORDER BY attempt_number DESC LIMIT 1)) THEN RAISE EXCEPTION 'CLINICAL_QC_ADAPTER_PENDING'; END IF;
 END IF; RETURN NEW;
END $$;
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('p4b_invalidate_pool()'::regprocedure) INTO definition;
 definition:=replace(definition,'BEGIN', $new$BEGIN
 IF TG_TABLE_NAME='analytical_attempt' AND nipt_operational_enabled() THEN
 IF (OLD.state,NEW.state) IN (('InProgress','AnalysisComplete'),('AnalysisComplete','FinalQcAccepted'),('FinalQcAccepted','Final')) AND (to_jsonb(NEW)-'state')=(to_jsonb(OLD)-'state') AND EXISTS(SELECT 1 FROM result_qc5_review q WHERE q.attempt_id=NEW.id) THEN RETURN NEW; END IF;
 END IF;
 $new$);
 EXECUTE definition;
END $$;
CREATE OR REPLACE FUNCTION p5_release_authorized() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT nipt_operational_enabled() $$;
ALTER TABLE result_gate_evaluation DROP CONSTRAINT result_gate_evaluation_outcome_check;
ALTER TABLE result_gate_evaluation ADD CONSTRAINT result_gate_evaluation_outcomes CHECK(outcome IN ('BLOCKED','PENDING_CERTIFICATION','RELEASE_HOLD','CERTIFIED_RELEASED'));
CREATE TABLE result_release_completed(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),release_id uuid NOT NULL UNIQUE REFERENCES result_release,version_id uuid NOT NULL UNIQUE REFERENCES result_report_version,actor_id uuid NOT NULL REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER result_release_completed_immutable BEFORE UPDATE OR DELETE ON result_release_completed FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE FUNCTION p5_operational_release_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT nipt_operational_enabled() THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN RETURN NEW; END IF;
 IF NEW.synthetic OR NOT nipt_operational_enabled() OR NOT EXISTS(SELECT 1 FROM result_report_version v JOIN result_qc5_review q ON q.version_id=v.id JOIN analytical_attempt a ON a.id=v.attempt_id JOIN nipt_case c ON c.id=v.case_id WHERE v.id=NEW.version_id AND v.state='CertifiedReleased' AND NOT v.synthetic AND v.round_id=NEW.round_id AND v.case_id=NEW.case_id AND c.current_round_id=v.round_id AND a.state='FinalQcAccepted' AND q.report_sha256=v.sha256 AND p4c_pool_current(q.dnb_id) AND p4c_handoff_verified(q.dnb_id) AND q.sequencing_id=(SELECT id FROM p4c_sequencing_attempt WHERE dnb_id=q.dnb_id ORDER BY attempt_number DESC LIMIT 1))
 OR NOT EXISTS(SELECT 1 FROM result_gate_evaluation g WHERE g.version_id=NEW.version_id AND g.eligible AND g.outcome='CERTIFIED_RELEASED' AND g.actor_id=NEW.certified_by)
 OR NOT EXISTS(SELECT 1 FROM role_assignment a WHERE a.user_id=NEW.certified_by AND a.role='LAB_CERTIFIER' AND a.approved_by IS NOT NULL AND a.effective_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now()))
 OR NOT p2_clinical_ready(NEW.round_id) OR EXISTS(SELECT 1 FROM p2_revocation WHERE case_id=NEW.case_id)
 THEN RAISE EXCEPTION 'RELEASE_CURRENT_QC5_AUTHORITY_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER p5_operational_release_guard BEFORE INSERT OR UPDATE ON result_release FOR EACH ROW EXECUTE FUNCTION p5_operational_release_guard();
REVOKE ALL ON result_qc5_review,result_release_completed FROM PUBLIC;
