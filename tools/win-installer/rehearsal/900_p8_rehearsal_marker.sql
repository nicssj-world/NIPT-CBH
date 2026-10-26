-- REHEARSAL ONLY (never part of the product): an additive, harmless migration used to exercise upgrade, rollback refusal and restore-then-migrate.
CREATE TABLE IF NOT EXISTS p8_rehearsal_marker(id integer PRIMARY KEY,note text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO p8_rehearsal_marker(id,note) VALUES(1,'p8 windows installer rehearsal') ON CONFLICT DO NOTHING;
