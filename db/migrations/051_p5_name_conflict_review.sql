-- P5 Owner decision A14 (2026-10-13): duplicates are detected by SHA-256 only. A file whose name matches an imported report but whose
-- bytes differ is never skipped and never becomes a revision by itself: the person proposing the link must state whether it is a
-- NEW_REPORT or a REVISION, and the second person approves exactly that classification. Forward-only; 050 is unchanged.
ALTER TABLE result_link_event ADD COLUMN name_review text CHECK(name_review IN ('NEW_REPORT','REVISION'));
ALTER TABLE result_link_event ADD CONSTRAINT result_link_name_review_revision CHECK(name_review IS DISTINCT FROM 'REVISION' OR revision IS NOT NULL);
ALTER TABLE result_link_event ADD CONSTRAINT result_link_name_review_new CHECK(name_review IS DISTINCT FROM 'NEW_REPORT' OR revision IS NULL);
CREATE INDEX result_intake_file_name ON result_intake_file(lower(coalesce(member_name,original_name)));
CREATE OR REPLACE FUNCTION p5_link_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE p result_link_event; BEGIN
 IF NEW.event IN ('APPROVED','REJECTED') THEN
  SELECT * INTO p FROM result_link_event WHERE version_id=NEW.version_id AND event='PROPOSED' ORDER BY sequence DESC LIMIT 1;
  IF p.id IS NULL OR EXISTS(SELECT 1 FROM result_link_event WHERE version_id=NEW.version_id AND event IN ('APPROVED','REJECTED','UNLINKED') AND sequence>p.sequence) THEN RAISE EXCEPTION 'LINK_PROPOSAL_REQUIRED'; END IF;
  IF p.actor_id=NEW.actor_id THEN RAISE EXCEPTION 'SECOND_PERSON_REQUIRED'; END IF;
  IF NEW.event='APPROVED' AND (p.round_id<>NEW.round_id OR p.attempt_id IS DISTINCT FROM NEW.attempt_id OR p.case_id<>NEW.case_id OR p.revision IS DISTINCT FROM NEW.revision OR p.name_review IS DISTINCT FROM NEW.name_review) THEN RAISE EXCEPTION 'LINK_APPROVAL_MISMATCH'; END IF;
 END IF;
 IF NEW.event='PROPOSED' AND EXISTS(SELECT 1 FROM result_link_event e WHERE e.version_id=NEW.version_id AND e.event='PROPOSED'
   AND NOT EXISTS(SELECT 1 FROM result_link_event x WHERE x.version_id=NEW.version_id AND x.event IN ('APPROVED','REJECTED','UNLINKED') AND x.sequence>e.sequence)) THEN RAISE EXCEPTION 'LINK_PROPOSAL_OPEN'; END IF;
 RETURN NEW; END $$;
