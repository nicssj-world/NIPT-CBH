-- Owner 2026-11-11: the Lab turnaround time (TAT) is 8 working days from the day the Lab received the specimen, warning when 2 or fewer remain.
-- Saturdays, Sundays and the holidays in the hospital's iCal calendar (Google Calendar, URL in Settings > tat) are not working days.
-- The calendar is synced when an administrator presses "ซิงก์วันหยุดตอนนี้", and once by the Worker when a year it needs is missing.
-- No patient data here. Forward-only; no existing row is changed.
CREATE TABLE business_holiday(
 day date PRIMARY KEY,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 200),
 source text NOT NULL DEFAULT 'ICAL' CHECK(source IN ('ICAL')),
 synced_at timestamptz NOT NULL DEFAULT now()
);

-- One row: the outcome of the latest sync (error is a stable code only, never the response body or the URL).
CREATE TABLE holiday_sync_state(
 id smallint PRIMARY KEY CHECK(id=1),
 last_attempt_at timestamptz,
 last_success_at timestamptz,
 last_error_code text CHECK(last_error_code IS NULL OR last_error_code ~ '^[A-Z0-9_]{1,64}$'),
 holiday_count integer NOT NULL DEFAULT 0 CHECK(holiday_count>=0),
 years integer[] NOT NULL DEFAULT '{}',
 trigger text CHECK(trigger IS NULL OR trigger IN ('MANUAL','WORKER')),
 actor_id uuid REFERENCES app_user
);
INSERT INTO holiday_sync_state(id) VALUES(1);

-- roles.sql repeats these grants after role creation on a fresh installation.
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON business_holiday TO app_rw;
  GRANT SELECT,UPDATE ON holiday_sync_state TO app_rw;
 END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='worker_rw') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON business_holiday TO worker_rw;
  GRANT SELECT,UPDATE ON holiday_sync_state TO worker_rw;
 END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='report_ro') THEN
  GRANT SELECT ON business_holiday,holiday_sync_state TO report_ro;
 END IF;
END $$;
