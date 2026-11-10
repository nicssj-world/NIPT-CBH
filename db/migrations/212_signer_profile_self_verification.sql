-- Owner 2026-11-10: nobody needs a second name. With one administrator account, the administrator who is also a licensed signer could never have
-- their own licence and signature profile verified (task3_signer_event_guard refused actor = profile owner), so they could not be named as
-- Reported by / Approved by. Same function, only the self check removed: a profile is still verified once, a revocation is still final, and the
-- verification still records who did it. Migration 192's pattern list did not cover this guard (its message is SIGNER_VERIFICATION_INVALID).
CREATE OR REPLACE FUNCTION task3_signer_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE p report_signer_profile; BEGIN
 SELECT * INTO p FROM report_signer_profile WHERE id=NEW.profile_id;
 IF NEW.event='VERIFIED' AND EXISTS(SELECT 1 FROM report_signer_profile_event WHERE profile_id=NEW.profile_id) THEN RAISE EXCEPTION 'SIGNER_VERIFICATION_INVALID'; END IF;
 IF NEW.event='REVOKED' AND EXISTS(SELECT 1 FROM report_signer_profile_event WHERE profile_id=NEW.profile_id AND event='REVOKED') THEN RAISE EXCEPTION 'SIGNER_ALREADY_REVOKED'; END IF;
 RETURN NEW;
END $$;
