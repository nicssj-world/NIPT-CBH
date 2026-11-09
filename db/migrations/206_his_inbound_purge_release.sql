-- A deleted ParseError keeps an immutable tombstone so the same broken bytes are not reported again (migration 202).
-- It must not hide a valid PET for ever (Owner 2026-11-09): when the current reader accepts those exact bytes, the scanner records a
-- release here and the file is inserted like any new one; the tombstone is then superseded by the normal replacement rule.
CREATE TABLE his_inbound_file_purge_release(
 sha256 text PRIMARY KEY REFERENCES his_inbound_file_purge,
 released_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER his_inbound_file_purge_release_immutable BEFORE UPDATE OR DELETE ON his_inbound_file_purge_release FOR EACH ROW EXECUTE FUNCTION immutable_row();

CREATE OR REPLACE FUNCTION his_inbound_file_purge_insert_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(75432803,hashtext(NEW.sha256));
 IF EXISTS(SELECT 1 FROM public.his_inbound_file_purge p WHERE p.sha256=NEW.sha256
  AND NOT EXISTS(SELECT 1 FROM public.his_inbound_file_purge_release r WHERE r.sha256=p.sha256)) THEN RETURN NULL; END IF;
 RETURN NEW;
END $$;

REVOKE ALL ON his_inbound_file_purge_release FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN
  EXECUTE 'GRANT SELECT ON his_inbound_file_purge_release TO app_rw';
 END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='worker_rw') THEN
  EXECUTE 'GRANT SELECT,INSERT ON his_inbound_file_purge_release TO worker_rw';
 END IF;
END $$;
