-- 188 created specimen_rejection_evidence without the application grant, so on the real roles (app_rw) the evidence list read and the rejection save with photos were refused.
-- Same append-only access as specimen_acceptance: read and insert, never update or delete.
DO $$ BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN
 GRANT SELECT,INSERT ON specimen_rejection_evidence TO app_rw;
 END IF; END $$;
