-- Registration correction is a retained tombstone. It hides an erroneous ANC case
-- without deleting identity, audit, consent, or downstream evidence.
CREATE TABLE p2_registration_void(
 case_id uuid PRIMARY KEY REFERENCES nipt_case(id),
 actor_id uuid NOT NULL REFERENCES app_user(id),
 reason text NOT NULL CHECK(length(trim(reason))>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER p2_registration_void_immutable BEFORE UPDATE OR DELETE ON p2_registration_void FOR EACH ROW EXECUTE FUNCTION security_immutable();
DO $$ BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN
 GRANT SELECT,INSERT ON p2_registration_void TO app_rw;
END IF; END $$;
