-- LAB_MANUAL_COMPLETE review retains the original Final PDF. It is not P5H promotion,
-- a new analytical execution, a new clinical certification, or permission to publish HIS files.
CREATE TABLE lab_manual_result_review(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 draft_id uuid NOT NULL REFERENCES historical_draft,
 draft_version integer NOT NULL,
 pdf_file_id uuid NOT NULL REFERENCES historical_batch_file,
 pdf_sha256 text NOT NULL CHECK(pdf_sha256 ~ '^[0-9a-f]{64}$'),
 paper_snapshot jsonb NOT NULL,
 attestation jsonb NOT NULL,
 reviewer_id uuid NOT NULL REFERENCES app_user,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER lab_manual_result_review_immutable BEFORE UPDATE OR DELETE ON lab_manual_result_review FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE FUNCTION lab_manual_result_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM role_assignment WHERE user_id=NEW.reviewer_id AND role='LAB_CERTIFIER' AND approved_by IS NOT NULL AND effective_from<=now() AND (expires_at IS NULL OR expires_at>now()))
 OR NOT EXISTS(SELECT 1 FROM historical_draft d JOIN historical_batch_file f ON f.id=d.pdf_file_id
 WHERE d.id=NEW.draft_id AND d.version=NEW.draft_version AND d.pdf_file_id=NEW.pdf_file_id
 AND f.sha256=NEW.pdf_sha256 AND f.state='Parsed' AND d.state NOT IN ('Abandoned','Promoted')
 AND NOT(NEW.reviewer_id=ANY(d.contributor_ids))) THEN RAISE EXCEPTION 'MANUAL_REVIEW_AUTHORITY_OR_SOURCE_INVALID'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lab_manual_result_review_guard BEFORE INSERT ON lab_manual_result_review FOR EACH ROW EXECUTE FUNCTION lab_manual_result_review_guard();
DO $$ BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN
 GRANT SELECT,INSERT ON lab_manual_result_review TO app_rw;
END IF; END $$;
