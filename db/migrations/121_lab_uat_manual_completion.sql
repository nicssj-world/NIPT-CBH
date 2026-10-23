-- LAB-UAT-008/013/026: owner-approved operator completion; retain immutable records.
CREATE OR REPLACE FUNCTION lab_manual_result_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM role_assignment WHERE user_id=NEW.reviewer_id AND role IN ('LAB_STAFF','LAB_CERTIFIER') AND effective_from<=now() AND (expires_at IS NULL OR expires_at>now()))
 OR NOT EXISTS(SELECT 1 FROM historical_draft d JOIN historical_batch_file f ON f.id=d.pdf_file_id
 WHERE d.id=NEW.draft_id AND d.version=NEW.draft_version AND d.pdf_file_id=NEW.pdf_file_id
 AND f.sha256=NEW.pdf_sha256 AND f.state='Parsed' AND d.state NOT IN ('Abandoned','Promoted'))
 THEN RAISE EXCEPTION 'MANUAL_REVIEW_AUTHORITY_OR_SOURCE_INVALID'; END IF;
 RETURN NEW;
END $$;
-- No reason/evidence text required for this pooling workflow. Existing notes remain.
ALTER TABLE lab_actual_pooling DROP CONSTRAINT lab_actual_pooling_note_check;
