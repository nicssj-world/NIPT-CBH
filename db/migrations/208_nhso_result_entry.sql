-- ลงผลสปสช. (Owner 2026-11-09): staff copy a released result into the NHSO system by hand, then confirm here.
-- One insert-only event stream per certified release: the latest event is the current state (CONFIRMED = entered,
-- NOT_NHSO = staff say the entitlement is not สปสช., CANCELLED = back to pending from either). A reissued result is a new release
-- and so starts pending again. No patient data is stored.
CREATE TABLE nhso_result_entry_event(
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 release_id uuid NOT NULL REFERENCES result_release(id),
 kind text NOT NULL CHECK(kind IN ('CONFIRMED','NOT_NHSO','CANCELLED')),
 actor_id uuid NOT NULL REFERENCES app_user,
 at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX nhso_result_entry_event_release ON nhso_result_entry_event(release_id,sequence DESC);
CREATE TRIGGER nhso_result_entry_event_immutable BEFORE UPDATE OR DELETE ON nhso_result_entry_event FOR EACH ROW EXECUTE FUNCTION immutable_row();
REVOKE ALL ON nhso_result_entry_event FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN
 GRANT SELECT,INSERT ON nhso_result_entry_event TO app_rw;GRANT USAGE ON SEQUENCE nhso_result_entry_event_sequence_seq TO app_rw;
END IF; END $$;
