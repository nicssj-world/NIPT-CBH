-- Restricted AL-2: synthetic-only P2. No clinical approval or operational release.
ALTER TABLE app_session ADD COLUMN signing_suspended boolean NOT NULL DEFAULT false;
CREATE TABLE p2_case_identity(case_id uuid PRIMARY KEY REFERENCES nipt_case,hn text NOT NULL CHECK(hn ~ '^0*990[0-9]{3,17}$'),synthetic boolean NOT NULL DEFAULT true CHECK(synthetic));
CREATE TRIGGER p2_identity_immutable BEFORE UPDATE OR DELETE ON p2_case_identity FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TABLE p2_workspace(
 round_id uuid PRIMARY KEY,case_id uuid NOT NULL,version integer NOT NULL DEFAULT 0 CHECK(version>=0),draft jsonb NOT NULL,
 request_mode text NOT NULL CHECK(request_mode IN ('Electronic','Paper')),consent_mode text NOT NULL CHECK(consent_mode IN ('Electronic','Paper')),
 updated_by uuid NOT NULL REFERENCES app_user,updated_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(round_id,case_id) REFERENCES specimen_round(id,case_id)
);
CREATE TABLE p2_doctor_version(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),doctor_key text NOT NULL CHECK(doctor_key ~ '^SYNTHETIC-[A-Z0-9-]+$'),version integer NOT NULL CHECK(version>0),
 name text NOT NULL CHECK(name LIKE 'SYNTHETIC%' OR name LIKE 'จำลอง%'),unit_id uuid NOT NULL REFERENCES unit,
 effective_from timestamptz NOT NULL,authorization_evidence text NOT NULL CHECK(authorization_evidence LIKE 'SYNTHETIC%'),signature jsonb NOT NULL,signature_png text NOT NULL,signature_hash text NOT NULL CHECK(length(signature_hash)=64),
 created_by uuid NOT NULL REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(doctor_key,version)
);
CREATE TABLE p2_doctor_event(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),doctor_version_id uuid NOT NULL REFERENCES p2_doctor_version,event_type text NOT NULL CHECK(event_type IN ('Approved','Suspended')),actor_id uuid NOT NULL REFERENCES app_user,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION p2_doctor_approval_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.event_type='Approved' AND EXISTS(SELECT 1 FROM p2_doctor_version WHERE id=NEW.doctor_version_id AND created_by=NEW.actor_id) THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED'; END IF; RETURN NEW; END $$;
CREATE TRIGGER p2_doctor_approval_guard BEFORE INSERT ON p2_doctor_event FOR EACH ROW EXECUTE FUNCTION p2_doctor_approval_guard();
CREATE TABLE p2_document_revision(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid NOT NULL,round_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('REQUEST','CONSENT')),
 version integer NOT NULL CHECK(version>0),template_version text NOT NULL CHECK(template_version LIKE 'SYNTHETIC-%'),payload jsonb NOT NULL,
 content_hash text NOT NULL CHECK(length(content_hash)=64),reason text NOT NULL CHECK(length(trim(reason))>0),created_by uuid NOT NULL REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(round_id,case_id) REFERENCES specimen_round(id,case_id),UNIQUE(round_id,kind,version),UNIQUE(id,case_id,round_id)
);
CREATE TABLE p2_collection_fact(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sequence bigint GENERATED ALWAYS AS IDENTITY,case_id uuid NOT NULL,round_id uuid NOT NULL,source text NOT NULL CHECK(source IN ('ANC','LAB_PAPER','SYNTHETIC_PATIENT')),collection_date date NOT NULL,collection_time text,reason text NOT NULL DEFAULT 'SYNTHETIC_CAPTURE',actor_id uuid NOT NULL REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(round_id,case_id) REFERENCES specimen_round(id,case_id));
CREATE TABLE p2_paper_review(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid NOT NULL,round_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('REQUEST','CONSENT')),template_version text NOT NULL CHECK(template_version LIKE 'SYNTHETIC-%'),document_reference text NOT NULL,panel jsonb NOT NULL,status text NOT NULL CHECK(status IN ('Pending','Verified','Declined','Replaced','Amended')),location text NOT NULL CHECK(length(trim(location))>0),reason text NOT NULL CHECK(length(trim(reason))>0),verifier_id uuid NOT NULL REFERENCES app_user,previous_id uuid REFERENCES p2_paper_review,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(round_id,case_id) REFERENCES specimen_round(id,case_id));
ALTER TABLE p2_paper_review ADD COLUMN acknowledgment_evidence jsonb NOT NULL DEFAULT '{}';
CREATE TABLE p2_request_ack(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid NOT NULL,round_id uuid NOT NULL,item text NOT NULL CHECK(item IN ('conditionA','conditionB')),answer text NOT NULL CHECK(answer IN ('Yes','No','Unknown')),workspace_version integer NOT NULL,actor_id uuid NOT NULL REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(round_id,case_id) REFERENCES specimen_round(id,case_id));
CREATE TABLE p2_signing_session(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid NOT NULL,round_id uuid NOT NULL,document_id uuid NOT NULL,
 staff_session_id uuid NOT NULL REFERENCES app_session,preparer_id uuid NOT NULL REFERENCES app_user,
 token_hash text UNIQUE NOT NULL CHECK(length(token_hash)=64),csrf_hash text NOT NULL CHECK(length(csrf_hash)=64),
 state text NOT NULL DEFAULT 'Active' CHECK(state IN ('Active','Completed','Cancelled','Invalidated','Expired')),
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,closed_at timestamptz,reauthenticated_at timestamptz,
 FOREIGN KEY(document_id,case_id,round_id) REFERENCES p2_document_revision(id,case_id,round_id),CHECK(expires_at>created_at)
);
CREATE UNIQUE INDEX p2_one_signing_session ON p2_signing_session(staff_session_id) WHERE state='Active';
CREATE TABLE p2_consent_ack(session_id uuid NOT NULL REFERENCES p2_signing_session,item integer NOT NULL CHECK(item BETWEEN 1 AND 12),acknowledged_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(session_id,item));
CREATE TABLE p2_consent_signature(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),session_id uuid UNIQUE NOT NULL REFERENCES p2_signing_session,document_id uuid NOT NULL REFERENCES p2_document_revision,
 decision text NOT NULL CHECK(decision IN ('Granted','Declined')),vector jsonb NOT NULL,png text NOT NULL,signature_hash text NOT NULL CHECK(length(signature_hash)=64),signed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE p2_final_consent(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),session_id uuid UNIQUE NOT NULL REFERENCES p2_signing_session,document_id uuid NOT NULL REFERENCES p2_document_revision,payload jsonb NOT NULL,content_hash text NOT NULL CHECK(length(content_hash)=64),created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION p2_final_consent_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM p2_signing_session s JOIN p2_consent_signature p ON p.session_id=s.id JOIN p2_document_revision d ON d.id=s.document_id WHERE s.id=NEW.session_id AND s.document_id=NEW.document_id AND s.state='Completed' AND s.reauthenticated_at IS NOT NULL
 AND NEW.payload->'session'->>'attestation'='true' AND NEW.payload->'session'->>'id'=s.id::text AND NEW.payload->'session'->>'preparerId'=s.preparer_id::text
 AND NEW.payload->'document'=d.payload AND NEW.payload->'signature'->>'decision'=p.decision AND NEW.payload->'signature'->>'signature_hash'=p.signature_hash
 AND NEW.payload->'signature'->'vector'=p.vector AND NEW.payload->'signature'->>'png'=p.png AND jsonb_array_length(NEW.payload->'acknowledgments')=12)
 THEN RAISE EXCEPTION 'PREPARER_ATTESTATION_REQUIRED'; END IF; RETURN NEW; END $$;
CREATE TRIGGER p2_final_consent_guard BEFORE INSERT ON p2_final_consent FOR EACH ROW EXECUTE FUNCTION p2_final_consent_guard();
CREATE FUNCTION p2_signature_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (SELECT count(*) FROM p2_consent_ack WHERE session_id=NEW.session_id)<>12 OR NOT EXISTS(SELECT 1 FROM p2_signing_session s JOIN p2_document_revision d ON d.id=s.document_id WHERE s.id=NEW.session_id AND s.document_id=NEW.document_id AND s.state='Active' AND s.expires_at>now() AND d.kind='CONSENT') THEN RAISE EXCEPTION 'SIGNING_SESSION_INVALID'; END IF; RETURN NEW; END $$;
CREATE TRIGGER p2_signature_guard BEFORE INSERT ON p2_consent_signature FOR EACH ROW EXECUTE FUNCTION p2_signature_guard();
CREATE TABLE p2_revocation(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid NOT NULL REFERENCES nipt_case,round_id uuid NOT NULL,stage text NOT NULL CHECK(stage IN ('W0','W1')),reason text NOT NULL CHECK(length(trim(reason))>0),actor_id uuid NOT NULL REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(round_id,case_id) REFERENCES specimen_round(id,case_id));
CREATE TABLE p2_disposition(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),revocation_id uuid NOT NULL REFERENCES p2_revocation,state text NOT NULL CHECK(state IN ('PendingGovernance','Recorded')),reason text NOT NULL,actor_id uuid NOT NULL REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE p2_document_access(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid NOT NULL REFERENCES nipt_case,document_id uuid NOT NULL REFERENCES p2_document_revision,session_id uuid NOT NULL REFERENCES app_session,actor_id uuid NOT NULL REFERENCES app_user,intent text NOT NULL CHECK(intent IN ('preview','download','print')),content_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['p2_doctor_version','p2_doctor_event','p2_document_revision','p2_collection_fact','p2_paper_review','p2_request_ack','p2_consent_ack','p2_consent_signature','p2_final_consent','p2_revocation','p2_disposition','p2_document_access'] LOOP EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION immutable_row()',t||'_immutable',t); END LOOP; END $$;
CREATE FUNCTION p2_paper_lineage_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.previous_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM p2_paper_review WHERE id=NEW.previous_id AND case_id=NEW.case_id AND round_id=NEW.round_id AND kind=NEW.kind) THEN RAISE EXCEPTION 'PAPER_LINEAGE_MISMATCH'; END IF; RETURN NEW; END $$;
CREATE TRIGGER p2_paper_lineage_guard BEFORE INSERT ON p2_paper_review FOR EACH ROW EXECUTE FUNCTION p2_paper_lineage_guard();
CREATE FUNCTION p2_workspace_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.case_id<>OLD.case_id OR NEW.round_id<>OLD.round_id OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'WORKSPACE_VERSION_REQUIRED'; END IF; RETURN NEW; END $$;
CREATE TRIGGER p2_workspace_guard BEFORE UPDATE ON p2_workspace FOR EACH ROW EXECUTE FUNCTION p2_workspace_guard();
CREATE FUNCTION p2_session_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.case_id<>OLD.case_id OR NEW.round_id<>OLD.round_id OR NEW.document_id<>OLD.document_id OR NEW.staff_session_id<>OLD.staff_session_id OR NEW.preparer_id<>OLD.preparer_id OR NEW.token_hash<>OLD.token_hash OR NEW.csrf_hash<>OLD.csrf_hash OR NEW.expires_at<>OLD.expires_at OR NEW.created_at<>OLD.created_at OR (OLD.state<>'Active' AND NEW.state<>OLD.state) THEN RAISE EXCEPTION 'IMMUTABLE_SIGNING_BINDING'; END IF; RETURN NEW; END $$;
CREATE TRIGGER p2_session_guard BEFORE UPDATE ON p2_signing_session FOR EACH ROW EXECUTE FUNCTION p2_session_guard();
