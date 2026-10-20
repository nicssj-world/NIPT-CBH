-- REHEARSAL ONLY (never part of the product): forces the automatic rollback gate to refuse a release after a health failure.
CREATE TABLE IF NOT EXISTS p8_health_recovery_marker(id integer PRIMARY KEY,note text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO p8_health_recovery_marker(id,note) VALUES(1,'p8 failed-health recovery rehearsal') ON CONFLICT DO NOTHING;
