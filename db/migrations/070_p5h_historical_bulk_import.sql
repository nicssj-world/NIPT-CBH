-- P5H restricted synthetic Historical Backfill: bulk staging, drafts, evaluation, second-person verification, guarded promotion.
-- Reserved band 070 (P5 = 050–051, P6 = 060). Forward-only; nothing here enables HIS output: historical cases still cannot own
-- his_order/specimen_round/attempt/report/release/export, and no outbound table references a historical draft or case.

CREATE TABLE historical_batch(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 state text NOT NULL DEFAULT 'Uploaded' CHECK(state IN ('Uploaded','Staging','Staged','Failed','Cancelled')),
 created_by uuid NOT NULL REFERENCES app_user,
 created_at timestamptz NOT NULL DEFAULT now(),
 idempotency_key text NOT NULL UNIQUE CHECK(length(idempotency_key) BETWEEN 16 AND 128),
 table_name text NOT NULL,
 table_sha256 text NOT NULL CHECK(table_sha256 ~ '^[a-f0-9]{64}$'),
 job_id uuid REFERENCES job_outbox,
 row_count integer CHECK(row_count IS NULL OR row_count>=0),
 error_code text,
 staged_at timestamptz,
 cutoff_version integer,                 -- go_live_cutoff revision used by the last staging (NULL = none configured, fail closed)
 policy jsonb,                           -- historical_backfill setting snapshot used by the last staging
 issues jsonb NOT NULL DEFAULT '[]'      -- batch-level findings (unused PDFs, rejected files)
);

CREATE TABLE historical_batch_file(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 batch_id uuid NOT NULL REFERENCES historical_batch,
 parent_id uuid REFERENCES historical_batch_file,
 role text NOT NULL CHECK(role IN ('TABLE','PDF','ZIP','ZIP_MEMBER')),
 original_name text NOT NULL CHECK(length(original_name) BETWEEN 1 AND 255),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 byte_size bigint NOT NULL CHECK(byte_size>0),
 state text NOT NULL DEFAULT 'Stored' CHECK(state IN ('Stored','Parsed','Rejected')),
 reject_code text,
 parsed jsonb,                            -- values read from the PDF for identity cross-check (never normal-by-default)
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,batch_id)
);
CREATE INDEX historical_batch_file_batch ON historical_batch_file(batch_id);

CREATE TABLE historical_draft(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 batch_id uuid NOT NULL REFERENCES historical_batch,
 row_no integer NOT NULL CHECK(row_no>0),
 ln text NOT NULL CHECK(length(ln) BETWEEN 1 AND 40),
 ln_key text CHECK(ln_key IS NULL OR (ln_key=ln AND ln_key ~ '^[0-9]+$')),   -- NULL while the row is a duplicate or invalid LN
 state text NOT NULL DEFAULT 'Draft' CHECK(state IN ('Draft','NotEligible','Submitted','Discrepancy','Conflict','Promoted','Abandoned')),
 data jsonb NOT NULL,
 issues jsonb NOT NULL DEFAULT '[]',
 pdf_file_id uuid,
 contributor_ids uuid[] NOT NULL CHECK(cardinality(contributor_ids)>0),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 evaluation_id uuid,
 promoted_case_id uuid REFERENCES nipt_case,
 promoted_key text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(batch_id,row_no),
 FOREIGN KEY(pdf_file_id,batch_id) REFERENCES historical_batch_file(id,batch_id),
 CHECK((state='Promoted')=(promoted_case_id IS NOT NULL))
);
-- One active draft per numeric LN (Plan §5.11). Conflict, Promoted and Abandoned are not active.
CREATE UNIQUE INDEX historical_one_active_draft ON historical_draft(ln_key) WHERE ln_key IS NOT NULL AND state NOT IN ('Promoted','Abandoned','Conflict');

CREATE TABLE historical_draft_revision(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 draft_id uuid NOT NULL REFERENCES historical_draft,
 version integer NOT NULL,
 data jsonb NOT NULL,
 actor_id uuid NOT NULL REFERENCES app_user,
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 250),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(draft_id,version)
);

CREATE TABLE historical_eligibility_evaluation(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 draft_id uuid NOT NULL REFERENCES historical_draft,
 draft_version integer NOT NULL,
 cutoff_version integer,
 cutoff date,
 outcome text NOT NULL CHECK(outcome IN ('Submitted','NotEligible')),
 reasons jsonb NOT NULL,
 snapshot jsonb NOT NULL,
 hash text NOT NULL CHECK(hash ~ '^[a-f0-9]{64}$'),
 evaluated_by uuid REFERENCES app_user,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(outcome<>'Submitted' OR (cutoff_version IS NOT NULL AND cutoff IS NOT NULL AND jsonb_array_length(reasons)=0))
);
ALTER TABLE historical_draft ADD CONSTRAINT historical_draft_evaluation_fk FOREIGN KEY(evaluation_id) REFERENCES historical_eligibility_evaluation(id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE historical_verification(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 draft_id uuid NOT NULL REFERENCES historical_draft,
 draft_version integer NOT NULL,
 verifier_id uuid NOT NULL REFERENCES app_user,
 result text NOT NULL CHECK(result IN ('CONFIRMED','DISCREPANCY')),
 attestation jsonb NOT NULL,
 batch_key text NOT NULL CHECK(length(batch_key) BETWEEN 16 AND 128),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(draft_id,draft_version,verifier_id,batch_key)
);

CREATE TABLE historical_record(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id uuid NOT NULL UNIQUE REFERENCES nipt_case,
 draft_id uuid NOT NULL UNIQUE REFERENCES historical_draft,
 state text NOT NULL DEFAULT 'Verified' CHECK(state IN ('Verified','RevisionPending','Discrepancy','Withdrawn')),
 evaluation_id uuid NOT NULL REFERENCES historical_eligibility_evaluation,
 verification_id uuid NOT NULL REFERENCES historical_verification,
 completeness jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER historical_revision_immutable BEFORE UPDATE OR DELETE ON historical_draft_revision FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER historical_evaluation_immutable BEFORE UPDATE OR DELETE ON historical_eligibility_evaluation FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER historical_verification_immutable BEFORE UPDATE OR DELETE ON historical_verification FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER historical_batch_file_delete_denied BEFORE DELETE ON historical_batch_file FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER historical_draft_delete_denied BEFORE DELETE ON historical_draft FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER historical_record_delete_denied BEFORE DELETE ON historical_record FOR EACH ROW EXECUTE FUNCTION immutable_row();

-- A verification is a second-person act: the verifier must hold HISTORICAL_VERIFIER and must not be any contributor to the draft (D-46, §6.3 item 17).
CREATE FUNCTION historical_verification_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d historical_draft;
BEGIN
 SELECT * INTO d FROM historical_draft WHERE id=NEW.draft_id;
 IF d.id IS NULL OR d.version<>NEW.draft_version THEN RAISE EXCEPTION 'HISTORICAL_VERIFICATION_STALE'; END IF;
 IF d.state<>'Submitted' THEN RAISE EXCEPTION 'HISTORICAL_DRAFT_NOT_SUBMITTED'; END IF;
 IF NEW.verifier_id = ANY(d.contributor_ids) THEN RAISE EXCEPTION 'HISTORICAL_SELF_VERIFICATION'; END IF;
 IF NOT EXISTS(SELECT 1 FROM role_assignment WHERE user_id=NEW.verifier_id AND role='HISTORICAL_VERIFIER') THEN RAISE EXCEPTION 'HISTORICAL_VERIFIER_ROLE_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER historical_verification_guard BEFORE INSERT ON historical_verification FOR EACH ROW EXECUTE FUNCTION historical_verification_guard();

-- Draft lifecycle (Plan §5.11): legal transitions only, no edit outside editable states, Submitted needs a passing evaluation of this exact version.
CREATE FUNCTION historical_draft_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e historical_eligibility_evaluation;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'Draft' THEN RAISE EXCEPTION 'HISTORICAL_DRAFT_STARTS_AS_DRAFT'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.state='Promoted' THEN RAISE EXCEPTION 'HISTORICAL_PROMOTED_IMMUTABLE'; END IF;
 IF NEW.batch_id<>OLD.batch_id OR NEW.row_no<>OLD.row_no OR (NEW.ln<>OLD.ln AND OLD.state NOT IN ('Draft','NotEligible','Discrepancy')) THEN RAISE EXCEPTION 'HISTORICAL_DRAFT_IDENTITY_IMMUTABLE'; END IF;
 IF (NEW.data IS DISTINCT FROM OLD.data OR NEW.pdf_file_id IS DISTINCT FROM OLD.pdf_file_id) AND OLD.state NOT IN ('Draft','NotEligible','Discrepancy') THEN RAISE EXCEPTION 'HISTORICAL_DRAFT_NOT_EDITABLE'; END IF;
 IF NEW.state<>OLD.state AND NOT (
   (OLD.state='Draft' AND NEW.state IN ('NotEligible','Submitted','Abandoned')) OR
   (OLD.state='NotEligible' AND NEW.state IN ('Draft','Abandoned')) OR
   (OLD.state='Submitted' AND NEW.state IN ('Discrepancy','Conflict','Promoted')) OR
   (OLD.state='Discrepancy' AND NEW.state='Draft')) THEN RAISE EXCEPTION 'HISTORICAL_ILLEGAL_TRANSITION'; END IF;
 IF NEW.state='Submitted' AND OLD.state<>'Submitted' THEN
  IF NEW.ln_key IS NULL THEN RAISE EXCEPTION 'HISTORICAL_SUBMIT_REQUIRES_UNIQUE_LN'; END IF;
  SELECT * INTO e FROM historical_eligibility_evaluation WHERE id=NEW.evaluation_id;
  IF e.id IS NULL OR e.draft_id<>NEW.id OR e.draft_version<>NEW.version OR e.outcome<>'Submitted' THEN RAISE EXCEPTION 'HISTORICAL_SUBMIT_REQUIRES_PASSING_EVALUATION'; END IF;
 END IF;
 IF NEW.state='Promoted' AND (current_setting('nipt.historical_promotion',true) IS DISTINCT FROM NEW.id::text OR NEW.promoted_key IS NULL) THEN RAISE EXCEPTION 'HISTORICAL_PROMOTION_ONLY_VIA_FUNCTION'; END IF;
 NEW.updated_at=now();
 RETURN NEW;
END $$;
CREATE TRIGGER historical_draft_guard BEFORE INSERT OR UPDATE ON historical_draft FOR EACH ROW EXECUTE FUNCTION historical_draft_guard();

-- case_guard: P1 refused every HISTORICAL insert. It now allows exactly one path: the promotion function, for a Submitted draft whose
-- current-version evaluation passed and whose current-version verification is a CONFIRMED second-person act. Immutability is unchanged.
CREATE OR REPLACE FUNCTION case_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d historical_draft;
BEGIN
 IF TG_OP='INSERT' AND NEW.registration_origin='HISTORICAL' THEN
  SELECT * INTO d FROM historical_draft WHERE id::text=current_setting('nipt.historical_promotion',true);
  IF d.id IS NULL OR d.state<>'Submitted' OR NOT EXISTS(SELECT 1 FROM historical_eligibility_evaluation e WHERE e.id=d.evaluation_id AND e.draft_id=d.id AND e.draft_version=d.version AND e.outcome='Submitted')
     OR NOT EXISTS(SELECT 1 FROM historical_verification v WHERE v.draft_id=d.id AND v.draft_version=d.version AND v.result='CONFIRMED' AND NOT v.verifier_id=ANY(d.contributor_ids))
  THEN RAISE EXCEPTION 'P1 historical promotion disabled'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND (NEW.registration_origin<>OLD.registration_origin OR NEW.identity_key<>OLD.identity_key) THEN RAISE EXCEPTION 'immutable origin and identity'; END IF;
 RETURN NEW;
END $$;

-- case_ln: DOCUMENT_VERIFIED / HISTORICAL_DOCUMENT belong to HISTORICAL cases only, and a HISTORICAL case can have nothing else.
ALTER TABLE case_ln DROP CONSTRAINT case_ln_verification_check;
ALTER TABLE case_ln ADD CONSTRAINT case_ln_verification_check CHECK(verification IN ('AWAITING_PET','VERIFIED_BY_PET','DOCUMENT_VERIFIED','RETIRED'));
CREATE OR REPLACE FUNCTION ln_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o text;
BEGIN
 SELECT registration_origin INTO o FROM nipt_case WHERE id=NEW.case_id;
 IF o='HISTORICAL' THEN
  IF NEW.source<>'HISTORICAL_DOCUMENT' OR NEW.verification<>'DOCUMENT_VERIFIED' THEN RAISE EXCEPTION 'historical LN is document verified'; END IF;
 ELSE
  IF NEW.verification<>'AWAITING_PET' THEN RAISE EXCEPTION 'LN begins awaiting PET'; END IF;
  IF NEW.source='HISTORICAL_DOCUMENT' THEN RAISE EXCEPTION 'document LN source is historical only'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION ln_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.case_id<>OLD.case_id OR NEW.ln<>OLD.ln OR NEW.version<>OLD.version OR NEW.source<>OLD.source THEN RAISE EXCEPTION 'immutable LN lineage'; END IF;
 IF NEW.verification='VERIFIED_BY_PET' AND OLD.verification<>'VERIFIED_BY_PET' AND pg_trigger_depth()<2 THEN RAISE EXCEPTION 'verification requires PET order'; END IF;
 IF NEW.verification='DOCUMENT_VERIFIED' AND OLD.verification<>'DOCUMENT_VERIFIED' THEN RAISE EXCEPTION 'document verification is set only at promotion'; END IF;
 IF OLD.verification='DOCUMENT_VERIFIED' AND NEW.verification NOT IN ('DOCUMENT_VERIFIED','RETIRED') THEN RAISE EXCEPTION 'historical LN can never be PET verified'; END IF;
 RETURN NEW; END $$;

-- The single promotion path. Caller holds the LN advisory lock (D-49); the function re-locks (re-entrant) and re-checks everything it relies on.
CREATE FUNCTION historical_promote(p_draft uuid, p_verification uuid, p_identity_key text, p_key text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE d historical_draft; v historical_verification; c uuid; r uuid;
BEGIN
 SELECT * INTO d FROM historical_draft WHERE id=p_draft FOR UPDATE;
 IF d.id IS NULL THEN RAISE EXCEPTION 'HISTORICAL_DRAFT_NOT_FOUND'; END IF;
 IF d.state='Promoted' THEN
  IF d.promoted_key=p_key THEN RETURN d.promoted_case_id; END IF;
  RAISE EXCEPTION 'HISTORICAL_ALREADY_PROMOTED';
 END IF;
 IF d.ln !~ '^[0-9]+$' THEN RAISE EXCEPTION 'HISTORICAL_LN_INVALID'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(d.ln,75432802));
 SELECT * INTO v FROM historical_verification WHERE id=p_verification AND draft_id=d.id AND draft_version=d.version AND result='CONFIRMED';
 IF v.id IS NULL THEN RAISE EXCEPTION 'HISTORICAL_VERIFICATION_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM case_ln WHERE ln=d.ln) THEN RAISE EXCEPTION 'HISTORICAL_LN_ALREADY_REGISTERED'; END IF;
 PERFORM set_config('nipt.historical_promotion', d.id::text, true);
 INSERT INTO nipt_case(registration_origin,identity_key) VALUES('HISTORICAL',p_identity_key) RETURNING id INTO c;
 INSERT INTO case_ln(case_id,ln,source,verification) VALUES(c,d.ln,'HISTORICAL_DOCUMENT','DOCUMENT_VERIFIED');
 INSERT INTO historical_record(case_id,draft_id,evaluation_id,verification_id,completeness) VALUES(c,d.id,d.evaluation_id,v.id,d.data->'completeness') RETURNING id INTO r;
 UPDATE historical_draft SET state='Promoted',promoted_case_id=c,promoted_key=p_key WHERE id=d.id;
 PERFORM set_config('nipt.historical_promotion','',true);
 RETURN c;
END $$;
