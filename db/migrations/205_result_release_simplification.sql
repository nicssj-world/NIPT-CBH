-- Result release simplification (Owner 2026-11-07), "every stuck item gets an exit".
-- 1. A result that is stuck in LinkConflict, Linked, ValidationBlocked or PendingCertification can be discarded (Voided).
--    p5_version_guard (installed by 050, never redefined since) is rewritten from its installed definition: only the four new pairs are added,
--    every other transition stays as it was. A pattern that is not found stops the migration, so nothing is changed half-way.
DO $guard$
DECLARE def text; fixed text;
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p WHERE p.proname='p5_version_guard' AND p.pronamespace='public'::regnamespace;
 IF def IS NULL THEN RAISE EXCEPTION 'P5_VERSION_GUARD_NOT_FOUND'; END IF;
 IF def LIKE '%(''PendingCertification'',''Voided'')%' THEN RAISE EXCEPTION 'P5_VERSION_GUARD_ALREADY_PATCHED'; END IF;
 fixed:=regexp_replace(def,'\(''CertifiedReleased'',''Voided''\)','(''CertifiedReleased'',''Voided''),(''LinkConflict'',''Voided''),(''Linked'',''Voided''),(''ValidationBlocked'',''Voided''),(''PendingCertification'',''Voided'')','g');
 IF fixed=def THEN RAISE EXCEPTION 'P5_VERSION_GUARD_PATTERN_NOT_FOUND'; END IF;
 EXECUTE fixed;
END $guard$;

-- 2. A HALOS result row that will never be reported can be hidden with a reason. The row itself stays immutable evidence;
--    the dismissal is a separate append-only record, read by the report worklist.
CREATE TABLE halos_row_dismissal(
 row_id uuid PRIMARY KEY REFERENCES halos_import_row,
 reason text NOT NULL CHECK(length(trim(reason))>=8),
 actor_id uuid NOT NULL REFERENCES app_user,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER halos_row_dismissal_immutable BEFORE UPDATE OR DELETE ON halos_row_dismissal FOR EACH ROW EXECUTE FUNCTION immutable_row();

-- The application role reads the worklist and records dismissals; the report read-only role only reads. PGlite tests do not enforce grants (lesson of 188/189).
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN GRANT SELECT,INSERT ON halos_row_dismissal TO app_rw; END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='report_ro') THEN GRANT SELECT ON halos_row_dismissal TO report_ro; END IF;
END $$;
