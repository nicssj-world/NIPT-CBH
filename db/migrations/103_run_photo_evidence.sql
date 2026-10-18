-- Run Photo Evidence (2026-10-18). Optional supporting photographs of a Run (lab_batch): tube racks and labels taken on a
-- mobile phone and uploaded over the LAN. FINAL OWNER LOCK: photos are evidence only, never a condition for work. No table,
-- constraint, trigger or function of the Run/Task List/QC/Pooling/Result/HIS workflow refers to these tables, and nothing
-- here requires a Run to have photos. Forward only; no existing object is changed.

-- Storage roots. A root is the folder (local Windows directory or UNC share) chosen by an administrator. Changing the path
-- creates a new root and retires the old one; photos keep pointing at the root they were written to, so earlier photos stay
-- readable and are never moved or deleted automatically. The path itself lives in run_photo_root_location (append-only),
-- so an installer can record a relocation after a disaster-recovery restore without rewriting history.
CREATE TABLE run_photo_storage_root(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 state text NOT NULL CHECK(state IN ('Active','Retired')),
 source text NOT NULL CHECK(source IN ('ADMIN','INSTALLATION_DEFAULT')),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 8 AND 250),
 created_by uuid REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT now(),
 retired_by uuid REFERENCES app_user,retired_at timestamptz,
 CHECK(source='INSTALLATION_DEFAULT' OR created_by IS NOT NULL),
 CHECK((state='Retired')=(retired_at IS NOT NULL))
);
CREATE UNIQUE INDEX run_photo_one_active_root ON run_photo_storage_root((true)) WHERE state='Active';
CREATE FUNCTION run_photo_root_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'RUN_PHOTO_ROOT_IMMUTABLE'; END IF;
 IF NEW.id<>OLD.id OR NEW.source<>OLD.source OR NEW.reason<>OLD.reason OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at<>OLD.created_at
  OR OLD.state<>'Active' OR NEW.state<>'Retired' THEN RAISE EXCEPTION 'RUN_PHOTO_ROOT_IMMUTABLE'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER run_photo_root_guard BEFORE UPDATE OR DELETE ON run_photo_storage_root FOR EACH ROW EXECUTE FUNCTION run_photo_root_guard();

CREATE TABLE run_photo_root_location(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 root_id uuid NOT NULL REFERENCES run_photo_storage_root,
 root_path text NOT NULL CHECK(length(root_path) BETWEEN 2 AND 400 AND root_path !~ '[[:cntrl:]]'),
 kind text NOT NULL CHECK(kind IN ('INITIAL','RELOCATED')),
 -- The access test that passed for this exact path, run by the account that stores the files (web process).
 test_receipt jsonb NOT NULL CHECK(test_receipt->>'ok'='true'),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 8 AND 250),
 actor_id uuid REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(kind='RELOCATED' OR actor_id IS NOT NULL OR reason='INSTALLATION_DEFAULT_ROOT')
);
CREATE UNIQUE INDEX run_photo_root_initial ON run_photo_root_location(root_id) WHERE kind='INITIAL';
CREATE TRIGGER run_photo_root_location_immutable BEFORE UPDATE OR DELETE ON run_photo_root_location FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE VIEW run_photo_root_current AS
 SELECT DISTINCT ON(l.root_id) r.id root_id,r.state,r.source,l.root_path,l.kind,l.created_at located_at FROM run_photo_storage_root r JOIN run_photo_root_location l ON l.root_id=r.id ORDER BY l.root_id,l.sequence DESC;

-- One row per uploaded photograph. Bytes are content-addressed under the root (sha256/aa/bb/<sha256>), never renamed,
-- re-encoded or resized; the original keeps its full resolution. The thumbnail is a separate derived file for quick
-- browsing only. Sample range = the uploader's statement "patients N–M of this Run", counted in slot order without the
-- PC/NC/Blank controls; it is a declaration, not a verified match between a tube and a patient.
CREATE TABLE run_photo(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 batch_id uuid NOT NULL REFERENCES lab_batch,root_id uuid NOT NULL REFERENCES run_photo_storage_root,
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),byte_size bigint NOT NULL CHECK(byte_size>0),
 media_type text NOT NULL CHECK(media_type IN ('image/jpeg','image/png','image/webp','image/heic','image/heif')),
 width integer CHECK(width>0),height integer CHECK(height>0),
 thumb_sha256 text CHECK(thumb_sha256 ~ '^[a-f0-9]{64}$'),thumb_bytes integer CHECK(thumb_bytes>0),
 original_name text NOT NULL CHECK(length(original_name) BETWEEN 1 AND 200 AND original_name !~ '[[:cntrl:]/\\]'),
 caption text NOT NULL DEFAULT '' CHECK(length(caption)<=1000 AND caption !~ '[\x01-\x08\x0b\x0c\x0e-\x1f]'),
 sample_from integer,sample_to integer,
 taken_on date NOT NULL,
 uploaded_by uuid NOT NULL REFERENCES app_user,uploaded_at timestamptz NOT NULL DEFAULT now(),
 idempotency_key text NOT NULL UNIQUE CHECK(idempotency_key ~ '^[A-Za-z0-9_-]{16,80}$'),
 state text NOT NULL DEFAULT 'Active' CHECK(state IN ('Active','Retracted')),
 retracted_by uuid REFERENCES app_user,retracted_at timestamptz,retract_reason text,
 row_version integer NOT NULL DEFAULT 1 CHECK(row_version>0),
 CHECK((thumb_sha256 IS NULL)=(thumb_bytes IS NULL)),
 CHECK((sample_from IS NULL)=(sample_to IS NULL)),
 CHECK(sample_from IS NULL OR (sample_from BETWEEN 1 AND 48 AND sample_to BETWEEN sample_from AND 48)),
 CHECK((state='Retracted')=(retracted_at IS NOT NULL AND retracted_by IS NOT NULL AND length(trim(retract_reason))>=8))
);
-- The same bytes cannot be filed twice in one Run (duplicate upload); a retracted copy no longer counts.
CREATE UNIQUE INDEX run_photo_one_active_copy ON run_photo(batch_id,sha256) WHERE state='Active';
CREATE INDEX run_photo_by_run ON run_photo(batch_id,taken_on DESC,uploaded_at DESC);
CREATE INDEX run_photo_by_date ON run_photo(taken_on);
CREATE INDEX run_photo_by_hash ON run_photo(sha256);
CREATE FUNCTION run_photo_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'RUN_PHOTO_DELETE_PROHIBITED'; END IF;
 IF NEW.id<>OLD.id OR NEW.root_id<>OLD.root_id OR NEW.sha256<>OLD.sha256 OR NEW.byte_size<>OLD.byte_size OR NEW.media_type<>OLD.media_type
  OR NEW.width IS DISTINCT FROM OLD.width OR NEW.height IS DISTINCT FROM OLD.height OR NEW.thumb_sha256 IS DISTINCT FROM OLD.thumb_sha256
  OR NEW.thumb_bytes IS DISTINCT FROM OLD.thumb_bytes OR NEW.original_name<>OLD.original_name OR NEW.uploaded_by<>OLD.uploaded_by
  OR NEW.uploaded_at<>OLD.uploaded_at OR NEW.idempotency_key<>OLD.idempotency_key THEN RAISE EXCEPTION 'RUN_PHOTO_EVIDENCE_IMMUTABLE'; END IF;
 IF OLD.state='Retracted' THEN RAISE EXCEPTION 'RUN_PHOTO_RETRACTED'; END IF;
 IF NEW.row_version<>OLD.row_version+1 THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER run_photo_guard BEFORE UPDATE OR DELETE ON run_photo FOR EACH ROW EXECUTE FUNCTION run_photo_guard();

-- Append-only history: upload, caption/range/date edit, move to the correct Run, retraction of a wrong upload.
CREATE TABLE run_photo_event(
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 photo_id uuid NOT NULL REFERENCES run_photo,
 event_type text NOT NULL CHECK(event_type IN ('UPLOADED','EDITED','MOVED','RETRACTED')),
 actor_id uuid NOT NULL REFERENCES app_user,
 reason text CHECK(reason IS NULL OR length(trim(reason)) BETWEEN 8 AND 500),
 before jsonb,after jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(event_type NOT IN ('MOVED','RETRACTED') OR reason IS NOT NULL)
);
CREATE INDEX run_photo_event_by_photo ON run_photo_event(photo_id,sequence);
CREATE TRIGGER run_photo_event_immutable BEFORE UPDATE OR DELETE ON run_photo_event FOR EACH ROW EXECUTE FUNCTION immutable_row();

DO $$ BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN
 GRANT SELECT,INSERT,UPDATE ON run_photo_storage_root,run_photo TO app_rw;
 GRANT SELECT,INSERT ON run_photo_root_location,run_photo_event TO app_rw;
 GRANT SELECT ON run_photo_root_current TO app_rw;
 END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='report_ro') THEN GRANT SELECT ON run_photo,run_photo_event TO report_ro; END IF;
END $$;
