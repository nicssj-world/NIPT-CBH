-- Owner P5-A (approved 2026-10-18): a final result PDF with exactly one clean match may be linked by the system without a
-- second person. Forward only. Migrations 050/051 are not edited; existing rows keep MANUAL_REVIEWED and stay valid.
-- Scope: linkage only. Release still needs the authorised "ตรวจรับ PDF และยืนยันส่งผล" (P5-B) and nothing is sent to HIS here.
-- The constraints replaced below are verified by name and exact definition first; anything else stops the migration.
DO $$ DECLARE expected jsonb:=jsonb_build_object(
  'result_report_version_link_mode_check','CHECK ((link_mode = ANY (ARRAY[''MANUAL_REVIEWED''::text, ''AUTO_PIC''::text])))',
  'result_link_event_event_check','CHECK ((event = ANY (ARRAY[''PROPOSED''::text, ''APPROVED''::text, ''REJECTED''::text, ''UNLINKED''::text])))',
  'result_link_event_mode_check','CHECK ((mode = ''MANUAL_REVIEWED''::text))',
  'result_link_event_check1','CHECK (((event = ''APPROVED''::text) = (outcome IS NOT NULL)))');
 k text; found text;
BEGIN
 FOR k IN SELECT jsonb_object_keys(expected) LOOP
  SELECT pg_get_constraintdef(oid) INTO found FROM pg_constraint WHERE conname=k AND conrelid IN ('result_report_version'::regclass,'result_link_event'::regclass);
  IF found IS DISTINCT FROM expected->>k THEN RAISE EXCEPTION 'MIGRATION_100_UNEXPECTED_CONSTRAINT %',k; END IF;
 END LOOP;
END $$;
ALTER TABLE result_report_version DROP CONSTRAINT result_report_version_link_mode_check;
ALTER TABLE result_report_version ADD CONSTRAINT result_report_version_link_mode_check CHECK(link_mode IN ('MANUAL_REVIEWED','AUTO_PIC','AUTO_UNIQUE'));
-- AUTO_PIC stays prohibited (result_report_version_link_mode_check1 unchanged).
ALTER TABLE result_link_event ADD COLUMN match_evidence jsonb;
ALTER TABLE result_link_event DROP CONSTRAINT result_link_event_event_check;
ALTER TABLE result_link_event ADD CONSTRAINT result_link_event_event_check CHECK(event IN ('PROPOSED','APPROVED','REJECTED','UNLINKED','AUTO_LINKED'));
ALTER TABLE result_link_event DROP CONSTRAINT result_link_event_mode_check;
ALTER TABLE result_link_event ADD CONSTRAINT result_link_event_mode_check CHECK(mode IN ('MANUAL_REVIEWED','AUTO_UNIQUE') AND (mode='AUTO_UNIQUE')=(event='AUTO_LINKED'));
ALTER TABLE result_link_event DROP CONSTRAINT result_link_event_check1;
ALTER TABLE result_link_event ADD CONSTRAINT result_link_event_outcome_required CHECK((event IN ('APPROVED','AUTO_LINKED'))=(outcome IS NOT NULL));
-- A system link is always a clean link of one attempt with recorded match evidence; a conflict is never auto-linked.
ALTER TABLE result_link_event ADD CONSTRAINT result_link_event_auto_linked CHECK(event<>'AUTO_LINKED' OR (outcome='Linked' AND round_id IS NOT NULL AND case_id IS NOT NULL AND attempt_id IS NOT NULL AND revision IS NULL AND name_review IS NULL
 AND jsonb_typeof(match_evidence)='object' AND (match_evidence->>'candidates')::int=1 AND match_evidence ? 'contract'));
ALTER TABLE result_link_event ADD CONSTRAINT result_link_event_evidence_auto_only CHECK((match_evidence IS NOT NULL)=(event='AUTO_LINKED'));

CREATE OR REPLACE FUNCTION p5_link_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE p result_link_event; BEGIN
 IF NEW.event IN ('APPROVED','REJECTED') THEN
  SELECT * INTO p FROM result_link_event WHERE version_id=NEW.version_id AND event='PROPOSED' ORDER BY sequence DESC LIMIT 1;
  IF p.id IS NULL OR EXISTS(SELECT 1 FROM result_link_event WHERE version_id=NEW.version_id AND event IN ('APPROVED','REJECTED','UNLINKED','AUTO_LINKED') AND sequence>p.sequence) THEN RAISE EXCEPTION 'LINK_PROPOSAL_REQUIRED'; END IF;
  IF p.actor_id=NEW.actor_id THEN RAISE EXCEPTION 'SECOND_PERSON_REQUIRED'; END IF;
  IF NEW.event='APPROVED' AND (p.round_id<>NEW.round_id OR p.attempt_id IS DISTINCT FROM NEW.attempt_id OR p.case_id<>NEW.case_id OR p.revision IS DISTINCT FROM NEW.revision OR p.name_review IS DISTINCT FROM NEW.name_review) THEN RAISE EXCEPTION 'LINK_APPROVAL_MISMATCH'; END IF;
 END IF;
 IF NEW.event IN ('PROPOSED','AUTO_LINKED') AND EXISTS(SELECT 1 FROM result_link_event e WHERE e.version_id=NEW.version_id AND e.event='PROPOSED'
   AND NOT EXISTS(SELECT 1 FROM result_link_event x WHERE x.version_id=NEW.version_id AND x.event IN ('APPROVED','REJECTED','UNLINKED','AUTO_LINKED') AND x.sequence>e.sequence)) THEN RAISE EXCEPTION 'LINK_PROPOSAL_OPEN'; END IF;
 IF NEW.event='AUTO_LINKED' THEN
  -- Only an unlinked final result, never a notice, a revision or a second report in a round's series.
  IF NOT EXISTS(SELECT 1 FROM result_report_version v WHERE v.id=NEW.version_id AND v.state='Unlinked' AND v.kind='RESULT' AND v.round_id IS NULL) THEN RAISE EXCEPTION 'AUTO_LINK_REQUIRES_UNLINKED_RESULT'; END IF;
  IF EXISTS(SELECT 1 FROM result_report_version o WHERE o.round_id=NEW.round_id AND o.kind='RESULT' AND o.id<>NEW.version_id) THEN RAISE EXCEPTION 'AUTO_LINK_SERIES_NOT_EMPTY'; END IF;
  -- A person already handled this version (proposal, rejection or unlink): it stays on the manual path.
  IF EXISTS(SELECT 1 FROM result_link_event x WHERE x.version_id=NEW.version_id AND x.event IN ('PROPOSED','REJECTED','UNLINKED','AUTO_LINKED')) THEN RAISE EXCEPTION 'AUTO_LINK_AFTER_HUMAN_DECISION'; END IF;
  IF NOT EXISTS(SELECT 1 FROM analytical_attempt a JOIN specimen_round r ON r.id=a.round_id JOIN nipt_case c ON c.id=r.case_id
   WHERE a.id=NEW.attempt_id AND r.id=NEW.round_id AND c.id=NEW.case_id AND c.current_round_id=r.id AND c.registration_origin<>'HISTORICAL'
   AND a.attempt_number=(SELECT max(b.attempt_number) FROM analytical_attempt b WHERE b.round_id=r.id)) THEN RAISE EXCEPTION 'AUTO_LINK_TARGET_NOT_CURRENT'; END IF;
 END IF;
 RETURN NEW; END $$;

-- A version can carry AUTO_UNIQUE only when its newest link event is the matching AUTO_LINKED event.
CREATE FUNCTION p5_auto_link_mode_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE e result_link_event; BEGIN
 IF NEW.link_mode='AUTO_UNIQUE' AND OLD.link_mode IS DISTINCT FROM 'AUTO_UNIQUE' THEN
  SELECT * INTO e FROM result_link_event WHERE version_id=NEW.id ORDER BY sequence DESC LIMIT 1;
  IF e.id IS NULL OR e.event<>'AUTO_LINKED' OR e.round_id IS DISTINCT FROM NEW.round_id OR e.attempt_id IS DISTINCT FROM NEW.attempt_id OR e.case_id IS DISTINCT FROM NEW.case_id OR NEW.state<>'Linked'
  THEN RAISE EXCEPTION 'AUTO_LINK_EVENT_REQUIRED'; END IF;
 END IF;
 RETURN NEW; END $$;
CREATE TRIGGER p5_auto_link_mode_guard BEFORE UPDATE OF link_mode ON result_report_version FOR EACH ROW EXECUTE FUNCTION p5_auto_link_mode_guard();
