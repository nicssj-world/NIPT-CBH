-- Web maker/checker must never receive usable credentials for a sensitive
-- target identity. Final enrollment is installation-owner-only, outside Web.
ALTER TABLE admin_access_request DROP CONSTRAINT admin_access_request_state_check;
ALTER TABLE admin_access_request ADD CONSTRAINT admin_access_request_state_check CHECK(state IN ('Pending','AwaitingEnrollment','Approved','Rejected'));
CREATE OR REPLACE FUNCTION admin_access_decision_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.state='Pending' THEN RETURN NEW; END IF;
 IF OLD.state='AwaitingEnrollment' AND NEW.state='Approved'
 AND NEW.decided_by=OLD.decided_by AND NEW.decided_at=OLD.decided_at
 AND pg_has_role(current_user,(SELECT tableowner FROM pg_tables WHERE schemaname='public' AND tablename='app_user'),'USAGE') THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'ACCESS_REQUEST_ALREADY_DECIDED_OR_OPERATOR_REQUIRED';
END $$;
