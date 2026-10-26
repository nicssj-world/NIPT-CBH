-- OWNER-LAB-056: Admin-managed ReadyGen-style report templates. An administrator brings a Singleton/Twin DOCX (upload or server
-- folder); the system inspects its ${placeholders}, renders a watermarked preview and checks it reads back with the same
-- verification used for real reports; an INDEPENDENT approver releases it; only then it becomes the Active template for that
-- kind. Every revision is immutable and never deleted, so final PDFs already issued stay bound to the template hash they used.
-- Without an Active revision the Owner's installed, SHA-256-locked masters keep working exactly as before. Forward-only.
CREATE TABLE report_template_revision(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK(kind IN('SINGLETON','TWIN')),
 version integer NOT NULL CHECK(version>0),
 file_sha256 text NOT NULL CHECK(file_sha256 ~ '^[0-9a-f]{64}$'),
 original_name text NOT NULL CHECK(length(original_name) BETWEEN 1 AND 255),
 byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 5242880),
 template_code text CHECK(template_code IS NULL OR length(template_code)<=60),
 product_in_template text CHECK(product_in_template IS NULL OR product_in_template ~ '^HNZ[0-9]{4}$'),
 tokens jsonb NOT NULL,
 inspection jsonb NOT NULL,
 source text NOT NULL CHECK(source IN('UPLOAD','FOLDER')),
 source_path text CHECK(source_path IS NULL OR length(source_path)<=500),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 250),
 created_by uuid NOT NULL REFERENCES app_user,
 created_at timestamptz NOT NULL DEFAULT now(),
 state text NOT NULL DEFAULT 'Uploaded' CHECK(state IN('Uploaded','Validated','Approved','Active','Archived','Rejected')),
 test_passed boolean NOT NULL DEFAULT false,
 tested_at timestamptz,
 preview_sha256 text CHECK(preview_sha256 IS NULL OR preview_sha256 ~ '^[0-9a-f]{64}$'),
 product_acknowledged_by uuid REFERENCES app_user,
 approved_by uuid REFERENCES app_user,
 approved_at timestamptz,
 activated_at timestamptz,
 UNIQUE(kind,version),
 CHECK(test_passed=(tested_at IS NOT NULL AND preview_sha256 IS NOT NULL)),
 CHECK(state NOT IN('Approved','Active') OR (approved_by IS NOT NULL AND approved_by<>created_by AND approved_at IS NOT NULL))
);
CREATE TABLE report_template_active(
 kind text PRIMARY KEY CHECK(kind IN('SINGLETON','TWIN')),
 revision_id uuid NOT NULL REFERENCES report_template_revision,
 changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION report_template_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'REPORT_TEMPLATE_IMMUTABLE'; END IF;
 IF (NEW.id,NEW.kind,NEW.version,NEW.file_sha256,NEW.original_name,NEW.byte_size,NEW.template_code,NEW.product_in_template,NEW.tokens,NEW.inspection,NEW.source,NEW.source_path,NEW.reason,NEW.created_by,NEW.created_at)
  IS DISTINCT FROM (OLD.id,OLD.kind,OLD.version,OLD.file_sha256,OLD.original_name,OLD.byte_size,OLD.template_code,OLD.product_in_template,OLD.tokens,OLD.inspection,OLD.source,OLD.source_path,OLD.reason,OLD.created_by,OLD.created_at)
 THEN RAISE EXCEPTION 'REPORT_TEMPLATE_IMMUTABLE'; END IF;
 IF OLD.state IN('Rejected') THEN RAISE EXCEPTION 'REPORT_TEMPLATE_REJECTED_FINAL'; END IF;
 IF NEW.state<>OLD.state THEN
  IF NOT((OLD.state='Uploaded' AND NEW.state IN('Validated','Rejected'))
   OR (OLD.state='Validated' AND NEW.state IN('Approved','Rejected'))
   OR (OLD.state='Approved' AND NEW.state IN('Active','Rejected'))
   OR (OLD.state='Active' AND NEW.state='Archived')
   OR (OLD.state='Archived' AND NEW.state='Active'))
  THEN RAISE EXCEPTION 'REPORT_TEMPLATE_STATE_INVALID'; END IF;
  IF NEW.state='Validated' AND (NOT NEW.test_passed OR jsonb_array_length(NEW.inspection->'errors')>0) THEN RAISE EXCEPTION 'REPORT_TEMPLATE_TEST_REQUIRED'; END IF;
 END IF;
 IF OLD.approved_by IS NOT NULL AND NEW.approved_by IS DISTINCT FROM OLD.approved_by THEN RAISE EXCEPTION 'REPORT_TEMPLATE_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER report_template_revision_guard BEFORE UPDATE OR DELETE ON report_template_revision FOR EACH ROW EXECUTE FUNCTION report_template_revision_guard();
CREATE FUNCTION report_template_active_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r report_template_revision; BEGIN
 SELECT * INTO r FROM report_template_revision WHERE id=NEW.revision_id;
 IF r.kind<>NEW.kind THEN RAISE EXCEPTION 'REPORT_TEMPLATE_KIND_MISMATCH'; END IF;
 IF r.state NOT IN('Approved','Active','Archived') OR r.approved_by IS NULL OR r.approved_by=r.created_by OR NOT r.test_passed
  OR jsonb_array_length(r.inspection->'errors')>0 THEN RAISE EXCEPTION 'REPORT_TEMPLATE_APPROVAL_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER report_template_active_guard BEFORE INSERT OR UPDATE ON report_template_active FOR EACH ROW EXECUTE FUNCTION report_template_active_guard();
CREATE FUNCTION report_template_active_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'REPORT_TEMPLATE_IMMUTABLE'; END $$;
CREATE TRIGGER report_template_active_no_delete BEFORE DELETE ON report_template_active FOR EACH ROW EXECUTE FUNCTION report_template_active_no_delete();
