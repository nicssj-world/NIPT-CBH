-- ผลตรวจยืนยัน (Confirm) (Owner 2026-11-23): a High Risk NIPT screening result is followed by a confirmatory test (amniocentesis / CVS / cord blood
-- or a postnatal test) sent to an outside laboratory. Lab staff record the outcome for each screening finding against the outlab PDF so the dashboard
-- can show how often the screening agreed (PPV).
-- One insert-only revision stream per (case, screening result version): the latest revision is the current record; a correction is a new revision.
-- `findings` maps each positive finding key of the screening result (t13/t18/t21/xo/xxx/xxy/xyy, or `other` for an abnormal result without a key)
-- to TRUE_POSITIVE / FALSE_POSITIVE / MOSAIC_OTHER. MOSAIC_OTHER counts as not concordant (Owner 2026-11-23). The PDF is a file_asset (content addressed).
CREATE TABLE confirm_result_revision(
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 case_id uuid NOT NULL REFERENCES nipt_case(id),
 version_id uuid NOT NULL REFERENCES result_report_version(id),
 status text NOT NULL CHECK(status IN ('PENDING','RESULTED','POSTNATAL','DECLINED','PREGNANCY_LOSS','LOST_FOLLOW_UP')),
 method text CHECK(method IN ('KARYOTYPE','QF_PCR','MICROARRAY','FISH','OTHER')),
 specimen text CHECK(specimen IN ('AMNIOTIC_FLUID','CVS','CORD_BLOOD','POSTNATAL_BLOOD','PRODUCT_OF_CONCEPTION','OTHER')),
 outlab_name text CHECK(char_length(outlab_name)<=200),
 procedure_date date,
 report_date date,
 result_text text CHECK(char_length(result_text)<=500),
 report_sha256 text REFERENCES file_asset(sha256),
 findings jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(findings)='object'),
 note text CHECK(char_length(note)<=1000),
 actor_id uuid NOT NULL REFERENCES app_user,
 at timestamptz NOT NULL DEFAULT clock_timestamp(),
 -- A confirmatory result needs its outlab PDF and at least one finding outcome; the service checks every finding of the screening result is answered.
 CONSTRAINT confirm_result_has_evidence CHECK(status NOT IN ('RESULTED','POSTNATAL') OR (report_sha256 IS NOT NULL AND findings<>'{}'::jsonb)),
 CONSTRAINT confirm_result_no_findings_without_result CHECK(status IN ('RESULTED','POSTNATAL') OR findings='{}'::jsonb)
);
CREATE INDEX confirm_result_revision_case ON confirm_result_revision(case_id,version_id,sequence DESC);
CREATE TRIGGER confirm_result_revision_immutable BEFORE UPDATE OR DELETE ON confirm_result_revision FOR EACH ROW EXECUTE FUNCTION immutable_row();
REVOKE ALL ON confirm_result_revision FROM PUBLIC;
-- roles.sql repeats these grants on a fresh install.
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN
  GRANT SELECT,INSERT ON confirm_result_revision TO app_rw;GRANT USAGE ON SEQUENCE confirm_result_revision_sequence_seq TO app_rw;
 END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='report_ro') THEN GRANT SELECT ON confirm_result_revision TO report_ro; END IF;
END $$;
