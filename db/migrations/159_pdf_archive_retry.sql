-- Retry is deliberately unavailable until the database can authenticate the
-- requesting administrator without trusting an identifier from app_rw.
-- No privileged function or role grant is installed by this migration.
SELECT 1;
