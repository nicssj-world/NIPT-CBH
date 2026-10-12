-- P5 restricted synthetic Result Management (Plan v6.2.1 §5.7, §5.9.2–§5.9.3, §5.10, §11.1–§11.10; OD-04 Owner rule).
-- Authored in the reserved P5 band (050+) while P4b holds 011–013 and adds DNB/Sequencing next; renumber to the next free
-- slot at integration if required (P3 precedent 090 → 008). Additive only; synthetic data only.
-- AL-5, OD-05 and OD-07 are not passed: no row can reach CertifiedReleased and no release can be inserted (p5_release_authorized).

-- 0. Release authority. A later, reviewed migration may replace this function only after AL-5 sign-off.
CREATE FUNCTION p5_release_authorized() RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT false $$;

-- 1. Quarantined intake (§11.1): every file seen by Preview, from the configured folder or the browser picker.
--    Original bytes are content-addressed in the file store; this row never changes its identity or bytes.
CREATE TABLE result_intake_file(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source text NOT NULL CHECK(source IN ('FOLDER','UPLOAD')),
 relative_path text CHECK(length(relative_path) BETWEEN 1 AND 500 AND relative_path !~ '[\r\n\0\\:]' AND relative_path !~ '(^|/)\.\.?(/|$)'),
 original_name text NOT NULL CHECK(length(original_name) BETWEEN 1 AND 255 AND original_name !~ '[\r\n\0/\\]'),
 parent_id uuid REFERENCES result_intake_file,member_name text CHECK(member_name IS NULL OR (length(member_name) BETWEEN 1 AND 255 AND member_name !~ '[\r\n\0]')),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),byte_size bigint NOT NULL CHECK(byte_size>0),
 container text CHECK(container IN ('PDF','ZIP_AS_PDF','ZIP_BATCH')),
 state text NOT NULL DEFAULT 'Quarantined' CHECK(state IN ('Quarantined','Parsed','Rejected','Duplicate','Imported','Expired')),
 reject_code text CHECK(reject_code ~ '^[A-Z0-9_]{1,64}$'),duplicate_of uuid,
 parser_version text,template_kind text CHECK(template_kind IN ('SINGLETON','TWIN','REDRAW_NOTICE','UNKNOWN')),parsed jsonb,
 actor_id uuid NOT NULL REFERENCES app_user,job_id uuid REFERENCES job_outbox,created_at timestamptz NOT NULL DEFAULT now(),decided_at timestamptz,
 synthetic boolean NOT NULL DEFAULT true CHECK(synthetic),
 CHECK((source='FOLDER')=(relative_path IS NOT NULL) OR parent_id IS NOT NULL),CHECK((parent_id IS NULL)=(member_name IS NULL)),
 CHECK((state='Rejected')=(reject_code IS NOT NULL)),CHECK(state<>'Parsed' OR (template_kind IS NOT NULL AND parser_version IS NOT NULL AND parsed IS NOT NULL) OR container='ZIP_BATCH')
);
CREATE INDEX result_intake_file_job ON result_intake_file(job_id);
CREATE INDEX result_intake_file_sha ON result_intake_file(sha256);
CREATE FUNCTION p5_intake_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.source<>OLD.source OR NEW.relative_path IS DISTINCT FROM OLD.relative_path OR NEW.original_name<>OLD.original_name OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
  OR NEW.member_name IS DISTINCT FROM OLD.member_name OR NEW.sha256<>OLD.sha256 OR NEW.byte_size<>OLD.byte_size OR NEW.actor_id<>OLD.actor_id OR NEW.created_at<>OLD.created_at OR NEW.job_id IS DISTINCT FROM OLD.job_id
  OR (OLD.container IS NOT NULL AND NEW.container IS DISTINCT FROM OLD.container) OR (OLD.parsed IS NOT NULL AND NEW.parsed IS DISTINCT FROM OLD.parsed)
  OR (OLD.parser_version IS NOT NULL AND NEW.parser_version IS DISTINCT FROM OLD.parser_version) OR (OLD.template_kind IS NOT NULL AND NEW.template_kind IS DISTINCT FROM OLD.template_kind)
 THEN RAISE EXCEPTION 'INTAKE_EVIDENCE_IMMUTABLE'; END IF;
 IF NEW.state<>OLD.state AND NOT ((OLD.state,NEW.state) IN (('Quarantined','Parsed'),('Quarantined','Rejected'),('Quarantined','Duplicate'),('Parsed','Imported'),('Parsed','Expired'),('Parsed','Duplicate')))
 THEN RAISE EXCEPTION 'INTAKE_TRANSITION_PROHIBITED'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER p5_intake_guard BEFORE UPDATE ON result_intake_file FOR EACH ROW EXECUTE FUNCTION p5_intake_guard();
CREATE TRIGGER result_intake_file_delete_denied BEFORE DELETE ON result_intake_file FOR EACH ROW EXECUTE FUNCTION immutable_row();

-- 2. Report versions (§5.7). One version per unique original file; linkage is per specimen round / attempt, never per HN or HIS LN.
CREATE TABLE result_report_version(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),intake_file_id uuid NOT NULL UNIQUE REFERENCES result_intake_file,
 sha256 text NOT NULL UNIQUE REFERENCES file_asset(sha256),kind text NOT NULL CHECK(kind IN ('RESULT','REDRAW_NOTICE','UNKNOWN')),
 template_kind text NOT NULL CHECK(template_kind IN ('SINGLETON','TWIN','REDRAW_NOTICE','UNKNOWN')),template_version text NOT NULL,parser_version text NOT NULL,parsed jsonb NOT NULL,
 state text NOT NULL DEFAULT 'Imported' CHECK(state IN ('Imported','Parsed','RejectedImport','Unlinked','LinkConflict','Linked','ValidationBlocked','PendingCertification','CertifiedReleased','Superseded','Voided')),
 case_id uuid,round_id uuid,attempt_id uuid REFERENCES analytical_attempt,link_mode text CHECK(link_mode IN ('MANUAL_REVIEWED','AUTO_PIC')),
 series_version integer CHECK(series_version>0),supersedes_id uuid REFERENCES result_report_version,revision jsonb,
 imported_by uuid NOT NULL REFERENCES app_user,imported_at timestamptz NOT NULL DEFAULT now(),state_changed_at timestamptz NOT NULL DEFAULT now(),row_version integer NOT NULL DEFAULT 0 CHECK(row_version>=0),
 synthetic boolean NOT NULL DEFAULT true CHECK(synthetic),
 FOREIGN KEY(round_id,case_id) REFERENCES specimen_round(id,case_id),
 CHECK((kind='UNKNOWN')=(template_kind='UNKNOWN')),CHECK(kind<>'UNKNOWN' OR state IN ('Imported','RejectedImport')),
 CHECK((state IN ('LinkConflict','Linked','ValidationBlocked','PendingCertification','CertifiedReleased'))<=(round_id IS NOT NULL AND link_mode IS NOT NULL)),
 CHECK(state NOT IN ('Linked','ValidationBlocked','PendingCertification','CertifiedReleased') OR kind<>'RESULT' OR attempt_id IS NOT NULL),
 CHECK((round_id IS NULL)=(case_id IS NULL)),CHECK(round_id IS NOT NULL OR (attempt_id IS NULL AND series_version IS NULL)),
 CHECK(link_mode IS DISTINCT FROM 'AUTO_PIC')
);
ALTER TABLE result_intake_file ADD CONSTRAINT result_intake_duplicate_fk FOREIGN KEY(duplicate_of) REFERENCES result_report_version;
CREATE INDEX result_report_version_state ON result_report_version(state,state_changed_at);
CREATE INDEX result_report_version_round ON result_report_version(round_id);
CREATE UNIQUE INDEX result_series_version ON result_report_version(round_id,kind,series_version) WHERE series_version IS NOT NULL;
-- Only one open (linked, not yet released or retired) version per round and report kind; a replacement goes through revision.
CREATE UNIQUE INDEX result_one_open_version ON result_report_version(round_id,kind) WHERE state IN ('LinkConflict','Linked','ValidationBlocked','PendingCertification');
CREATE FUNCTION p5_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.intake_file_id<>OLD.intake_file_id OR NEW.sha256<>OLD.sha256 OR NEW.kind<>OLD.kind OR NEW.template_kind<>OLD.template_kind OR NEW.template_version<>OLD.template_version
  OR NEW.parser_version<>OLD.parser_version OR NEW.parsed<>OLD.parsed OR NEW.imported_by<>OLD.imported_by OR NEW.imported_at<>OLD.imported_at
  OR (OLD.series_version IS NOT NULL AND NEW.series_version IS DISTINCT FROM OLD.series_version) OR (OLD.supersedes_id IS NOT NULL AND NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id)
  OR (OLD.revision IS NOT NULL AND NEW.revision IS DISTINCT FROM OLD.revision) OR NEW.row_version<>OLD.row_version+1
 THEN RAISE EXCEPTION 'REPORT_VERSION_IMMUTABLE'; END IF;
 -- The round of a version never moves once a series number exists; unlinking before a number is assigned is the only correction.
 IF OLD.series_version IS NOT NULL AND (NEW.round_id IS DISTINCT FROM OLD.round_id OR NEW.case_id IS DISTINCT FROM OLD.case_id) THEN RAISE EXCEPTION 'REPORT_SERIES_IMMUTABLE'; END IF;
 IF NEW.state='CertifiedReleased' AND NOT p5_release_authorized() THEN RAISE EXCEPTION 'RELEASE_HOLD_AL5'; END IF;
 IF NEW.state<>OLD.state AND NOT ((OLD.state,NEW.state) IN (('Imported','Parsed'),('Imported','RejectedImport'),('Parsed','Unlinked'),('Unlinked','Linked'),('Unlinked','LinkConflict'),('Unlinked','Voided'),
  ('LinkConflict','Unlinked'),('Linked','ValidationBlocked'),('Linked','PendingCertification'),('Linked','Unlinked'),('ValidationBlocked','PendingCertification'),('ValidationBlocked','Unlinked'),
  ('ValidationBlocked','Superseded'),('PendingCertification','ValidationBlocked'),('PendingCertification','CertifiedReleased'),('PendingCertification','Superseded'),('PendingCertification','Unlinked'),
  ('LinkConflict','Superseded'),('CertifiedReleased','Superseded'),('CertifiedReleased','Voided')))
 THEN RAISE EXCEPTION 'REPORT_TRANSITION_PROHIBITED'; END IF;
 NEW.state_changed_at:=CASE WHEN NEW.state<>OLD.state THEN now() ELSE OLD.state_changed_at END;
 RETURN NEW; END $$;
CREATE TRIGGER p5_version_guard BEFORE UPDATE ON result_report_version FOR EACH ROW EXECUTE FUNCTION p5_version_guard();
CREATE FUNCTION p5_version_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.state NOT IN ('Imported') OR NEW.round_id IS NOT NULL OR NEW.row_version<>0 THEN RAISE EXCEPTION 'REPORT_VERSION_STARTS_IMPORTED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM result_intake_file i WHERE i.id=NEW.intake_file_id AND i.sha256=NEW.sha256 AND i.state='Parsed' AND i.parsed=NEW.parsed AND i.parser_version=NEW.parser_version AND i.template_kind=NEW.template_kind)
 THEN RAISE EXCEPTION 'REPORT_VERSION_REQUIRES_PARSED_INTAKE'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER p5_version_insert_guard BEFORE INSERT ON result_report_version FOR EACH ROW EXECUTE FUNCTION p5_version_insert_guard();
CREATE TRIGGER result_report_version_delete_denied BEFORE DELETE ON result_report_version FOR EACH ROW EXECUTE FUNCTION immutable_row();

-- 3. Append-only state history of each version.
CREATE TABLE result_version_event(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sequence bigint GENERATED ALWAYS AS IDENTITY,version_id uuid NOT NULL REFERENCES result_report_version,
 from_state text,to_state text NOT NULL,actor_id uuid REFERENCES app_user,reason text,details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX result_version_event_version ON result_version_event(version_id,sequence);
CREATE TRIGGER result_version_event_immutable BEFORE UPDATE OR DELETE ON result_version_event FOR EACH ROW EXECUTE FUNCTION immutable_row();

-- 4. Manual reviewed linkage (§11.3, D-18): a proposal by one person and an approval by a different person, against one attempt
--    (or one round for a Redraw notice). HN or HIS LN alone never produces a link — there is no automatic path in this migration.
CREATE TABLE result_link_event(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sequence bigint GENERATED ALWAYS AS IDENTITY,version_id uuid NOT NULL REFERENCES result_report_version,
 event text NOT NULL CHECK(event IN ('PROPOSED','APPROVED','REJECTED','UNLINKED')),mode text NOT NULL DEFAULT 'MANUAL_REVIEWED' CHECK(mode='MANUAL_REVIEWED'),
 case_id uuid,round_id uuid,attempt_id uuid REFERENCES analytical_attempt,outcome text CHECK(outcome IN ('Linked','LinkConflict')),
 reason text NOT NULL CHECK(length(trim(reason))>=8),cross_check jsonb NOT NULL DEFAULT '{}',revision jsonb,actor_id uuid NOT NULL REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(round_id,case_id) REFERENCES specimen_round(id,case_id),
 CHECK(event NOT IN ('PROPOSED','APPROVED') OR round_id IS NOT NULL),CHECK((event='APPROVED')=(outcome IS NOT NULL))
);
CREATE INDEX result_link_event_version ON result_link_event(version_id,sequence);
CREATE FUNCTION p5_link_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE p result_link_event; BEGIN
 IF NEW.event IN ('APPROVED','REJECTED') THEN
  SELECT * INTO p FROM result_link_event WHERE version_id=NEW.version_id AND event='PROPOSED' ORDER BY sequence DESC LIMIT 1;
  IF p.id IS NULL OR EXISTS(SELECT 1 FROM result_link_event WHERE version_id=NEW.version_id AND event IN ('APPROVED','REJECTED','UNLINKED') AND sequence>p.sequence) THEN RAISE EXCEPTION 'LINK_PROPOSAL_REQUIRED'; END IF;
  IF p.actor_id=NEW.actor_id THEN RAISE EXCEPTION 'SECOND_PERSON_REQUIRED'; END IF;
  IF NEW.event='APPROVED' AND (p.round_id<>NEW.round_id OR p.attempt_id IS DISTINCT FROM NEW.attempt_id OR p.case_id<>NEW.case_id OR p.revision IS DISTINCT FROM NEW.revision) THEN RAISE EXCEPTION 'LINK_APPROVAL_MISMATCH'; END IF;
 END IF;
 IF NEW.event='PROPOSED' AND EXISTS(SELECT 1 FROM result_link_event e WHERE e.version_id=NEW.version_id AND e.event='PROPOSED'
   AND NOT EXISTS(SELECT 1 FROM result_link_event x WHERE x.version_id=NEW.version_id AND x.event IN ('APPROVED','REJECTED','UNLINKED') AND x.sequence>e.sequence)) THEN RAISE EXCEPTION 'LINK_PROPOSAL_OPEN'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER p5_link_event_guard BEFORE INSERT ON result_link_event FOR EACH ROW EXECUTE FUNCTION p5_link_event_guard();
CREATE TRIGGER result_link_event_immutable BEFORE UPDATE OR DELETE ON result_link_event FOR EACH ROW EXECUTE FUNCTION immutable_row();

-- 5. Gate evaluations (RG/RN), always re-evaluated inside the transaction that acts (D-27/D-28). Idempotency per certify attempt.
CREATE TABLE result_gate_evaluation(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),version_id uuid NOT NULL REFERENCES result_report_version,gate text NOT NULL CHECK(gate IN ('RG','RN')),
 purpose text NOT NULL CHECK(purpose IN ('VALIDATION','CERTIFY_ATTEMPT')),rule_version text NOT NULL,predicates jsonb NOT NULL,eligible boolean NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('BLOCKED','PENDING_CERTIFICATION','RELEASE_HOLD')),actor_id uuid REFERENCES app_user,
 idempotency_key text UNIQUE CHECK(idempotency_key ~ '^[A-Za-z0-9_-]{16,80}$'),created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(purpose<>'CERTIFY_ATTEMPT' OR (actor_id IS NOT NULL AND idempotency_key IS NOT NULL)),CHECK(outcome<>'RELEASE_HOLD' OR (purpose='CERTIFY_ATTEMPT' AND eligible)),
 CHECK(outcome<>'PENDING_CERTIFICATION' OR (purpose='VALIDATION' AND eligible))
);
CREATE INDEX result_gate_evaluation_version ON result_gate_evaluation(version_id,created_at);
CREATE TRIGGER result_gate_evaluation_immutable BEFORE UPDATE OR DELETE ON result_gate_evaluation FOR EACH ROW EXECUTE FUNCTION immutable_row();

-- 6. Review attestation of the parsed values against the original PDF. OD-04: the reviewer may later certify if authorised.
CREATE TABLE result_review(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),version_id uuid NOT NULL REFERENCES result_report_version,reviewer_id uuid NOT NULL REFERENCES app_user,
 values_match_pdf boolean NOT NULL CHECK(values_match_pdf),abnormal_acknowledged boolean NOT NULL,note text CHECK(note IS NULL OR length(note)<=500),
 row_version integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER result_review_immutable BEFORE UPDATE OR DELETE ON result_review FOR EACH ROW EXECUTE FUNCTION immutable_row();

-- 7. Releases (§5.8). Defined now so the ANC viewer, revisions and voids have one contract; inserting is impossible until AL-5.
CREATE TABLE result_release(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),version_id uuid NOT NULL UNIQUE REFERENCES result_report_version,case_id uuid NOT NULL,round_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('RESULT','REDRAW_NOTICE')),channel text NOT NULL CHECK(channel IN ('NIPT_ANC_VIEW')),epoch integer NOT NULL DEFAULT 0 CHECK(epoch>=0),
 state text NOT NULL DEFAULT 'Active' CHECK(state IN ('Active','Superseded','Voided','Withdrawn')),certified_by uuid NOT NULL REFERENCES app_user,certified_at timestamptz NOT NULL DEFAULT now(),
 void_reason text,synthetic boolean NOT NULL DEFAULT true CHECK(synthetic),FOREIGN KEY(round_id,case_id) REFERENCES specimen_round(id,case_id)
);
CREATE UNIQUE INDEX result_one_active_release ON result_release(round_id,kind) WHERE state='Active';
CREATE FUNCTION p5_release_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT p5_release_authorized() THEN RAISE EXCEPTION 'RELEASE_HOLD_AL5'; END IF;
 IF TG_OP='UPDATE' AND (NEW.version_id<>OLD.version_id OR NEW.case_id<>OLD.case_id OR NEW.round_id<>OLD.round_id OR NEW.kind<>OLD.kind OR NEW.certified_by<>OLD.certified_by OR NEW.certified_at<>OLD.certified_at
  OR NEW.epoch<OLD.epoch OR OLD.state<>'Active') THEN RAISE EXCEPTION 'RELEASE_IMMUTABLE'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER p5_release_guard BEFORE INSERT OR UPDATE ON result_release FOR EACH ROW EXECUTE FUNCTION p5_release_guard();
CREATE TRIGGER result_release_delete_denied BEFORE DELETE ON result_release FOR EACH ROW EXECUTE FUNCTION immutable_row();

-- 8. Access log for result views and original-file reads (§11.8). No values, only who/what/when.
CREATE TABLE result_access_log(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid NOT NULL REFERENCES app_user,case_id uuid REFERENCES nipt_case,version_id uuid REFERENCES result_report_version,
 purpose text NOT NULL CHECK(purpose IN ('ANC_RESULT_LIST','ANC_RESULT_FILE','LAB_REVIEW_FILE')),accessed_at timestamptz NOT NULL DEFAULT now(),synthetic boolean NOT NULL DEFAULT true CHECK(synthetic)
);
CREATE INDEX result_access_log_time ON result_access_log(accessed_at);
CREATE TRIGGER result_access_log_immutable BEFORE UPDATE OR DELETE ON result_access_log FOR EACH ROW EXECUTE FUNCTION immutable_row();
