-- The Worker resolves the report template when it finalizes a batch item: the Active registry revision, else the installed master.
-- Migrations 216-217 missed these two tables because the native test handed the template to the Worker directly; the Worker only receives its file store.
-- Read-only. roles.sql repeats this after role creation on a fresh installation.
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='worker_rw') THEN
  EXECUTE 'GRANT SELECT ON report_template_active,report_template_revision TO worker_rw';
 END IF;
END $$;
