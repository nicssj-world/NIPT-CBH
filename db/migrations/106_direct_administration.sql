-- Owner-authorized direct user administration. Preserve legacy requests as evidence.
ALTER TABLE app_user ADD COLUMN job_position text NOT NULL DEFAULT '' CHECK(length(job_position)<=120);
ALTER TABLE app_user ADD COLUMN phone text NOT NULL DEFAULT '' CHECK(length(phone)<=40);
CREATE TABLE p2_doctor_registration(
 doctor_version_id uuid PRIMARY KEY REFERENCES p2_doctor_version(id),
 actor_id uuid NOT NULL REFERENCES app_user(id),
 authorized boolean NOT NULL CHECK(authorized),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER p2_doctor_registration_immutable BEFORE UPDATE OR DELETE ON p2_doctor_registration FOR EACH ROW EXECUTE FUNCTION security_immutable();
CREATE OR REPLACE FUNCTION p2_doctor_approval_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.event_type='Approved' AND EXISTS(SELECT 1 FROM p2_doctor_version WHERE id=NEW.doctor_version_id AND created_by=NEW.actor_id)
 AND NOT EXISTS(SELECT 1 FROM p2_doctor_registration WHERE doctor_version_id=NEW.doctor_version_id AND actor_id=NEW.actor_id AND authorized)
 THEN RAISE EXCEPTION 'MAKER_CHECKER_REQUIRED'; END IF; RETURN NEW; END $$;
CREATE TABLE admin_access_supersession(
 request_id uuid PRIMARY KEY REFERENCES admin_access_request(id),
 actor_id uuid NOT NULL REFERENCES app_user(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER admin_access_supersession_immutable BEFORE UPDATE OR DELETE ON admin_access_supersession FOR EACH ROW EXECUTE FUNCTION security_immutable();
DO $$ BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN
 GRANT SELECT,INSERT ON admin_access_supersession TO app_rw;
 GRANT SELECT,INSERT ON p2_doctor_registration TO app_rw;
END IF; END $$;
