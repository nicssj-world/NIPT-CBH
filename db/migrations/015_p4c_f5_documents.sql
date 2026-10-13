-- Simulation F5 documents. No operational issue or clinical acceptance exists.
CREATE TABLE p4c_document(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dnb_id uuid NOT NULL REFERENCES p4c_dnb_attempt,
 kind text NOT NULL CHECK(kind IN ('PRE_WORK','COMPLETED')), revision integer NOT NULL CHECK(revision>0),
 snapshot jsonb NOT NULL CHECK(snapshot->>'synthetic'='true' AND snapshot->>'clinicalUsable'='false'
 AND snapshot->>'purpose'='SYNTHETIC_SIMULATION'),
 file_sha256 text NOT NULL CHECK(file_sha256 ~ '^[a-f0-9]{64}$'),
 issued_by uuid NOT NULL REFERENCES app_user, issued_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(dnb_id,kind,revision)
);
CREATE TABLE p4c_document_copy(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), document_id uuid NOT NULL REFERENCES p4c_document,
 copy_number integer NOT NULL CHECK(copy_number>0),kind text NOT NULL CHECK(kind IN ('WORKING_COPY','ORIGINAL_REPRINT','STATUS_MARKED')),
 file_sha256 text NOT NULL CHECK(file_sha256 ~ '^[a-f0-9]{64}$'),derived_from text NOT NULL CHECK(derived_from ~ '^[a-f0-9]{64}$'),
 reason text NOT NULL CHECK(length(trim(reason))>=8),actor_id uuid NOT NULL REFERENCES app_user,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(document_id,copy_number)
);
CREATE TRIGGER p4c_document_immutable BEFORE UPDATE OR DELETE ON p4c_document FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER p4c_document_copy_immutable BEFORE UPDATE OR DELETE ON p4c_document_copy FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE FUNCTION p4c_copy_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM p4c_document WHERE id=NEW.document_id AND file_sha256=NEW.derived_from) THEN RAISE EXCEPTION 'ORIGINAL_HASH_MISMATCH'; END IF;
 IF NEW.kind='ORIGINAL_REPRINT' AND NEW.file_sha256<>NEW.derived_from THEN RAISE EXCEPTION 'ORIGINAL_REPRINT_BYTES_CHANGED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER p4c_copy_guard BEFORE INSERT ON p4c_document_copy FOR EACH ROW EXECUTE FUNCTION p4c_copy_guard();
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_rw') THEN
 GRANT SELECT,INSERT ON p4c_document,p4c_document_copy TO app_rw;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='report_ro') THEN
 GRANT SELECT ON p4c_document TO report_ro;
 END IF;
END $$;
