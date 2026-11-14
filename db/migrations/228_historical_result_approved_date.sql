-- Owner 2026-11-15: a result reported by the previous system (historical_reported_result) is dated by the "Approved Date" printed on its PDF,
-- not by the day it was imported. Those ReadyGen PDFs print "Approved Date: 04 - Nov - 2026" beside the approver's signature and no
-- "Reported Date:", so the parsed evidence (immutable) has no report date. This table holds the date read from the very same bytes
-- (sha256 must match the version), written once by tools/migration/historical-approved-date-20261115.ts; it is never changed or deleted.
-- Results certified in NIPT-CBH keep their certification time; nothing here touches them.
CREATE TABLE historical_result_approved_date(
 version_id uuid PRIMARY KEY REFERENCES result_report_version,
 sha256 text NOT NULL,
 approved_on date NOT NULL,
 raw text NOT NULL CHECK(length(raw) BETWEEN 1 AND 200),
 actor_id uuid NOT NULL REFERENCES app_user,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 synthetic boolean NOT NULL DEFAULT (NOT nipt_operational_enabled())
);
CREATE FUNCTION historical_approved_date_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'IMMUTABLE_RECORD'; END IF;
 IF NOT EXISTS(SELECT 1 FROM result_report_version v WHERE v.id=NEW.version_id AND v.kind='RESULT' AND v.sha256=NEW.sha256)
 THEN RAISE EXCEPTION 'HISTORICAL_APPROVED_DATE_VERSION_MISMATCH'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER historical_approved_date_guard BEFORE INSERT OR UPDATE OR DELETE ON historical_result_approved_date FOR EACH ROW EXECUTE FUNCTION historical_approved_date_guard();
CREATE TRIGGER operational_provenance BEFORE INSERT ON historical_result_approved_date FOR EACH ROW EXECUTE FUNCTION p2_operational_provenance_guard();

DO $$ BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN
 GRANT SELECT,INSERT ON historical_result_approved_date TO app_rw;
END IF;
IF EXISTS(SELECT FROM pg_roles WHERE rolname='worker_rw') THEN
 GRANT SELECT ON historical_result_approved_date TO worker_rw;
END IF;
IF EXISTS(SELECT FROM pg_roles WHERE rolname='report_ro') THEN
 GRANT SELECT ON historical_result_approved_date TO report_ro;
END IF; END $$;
