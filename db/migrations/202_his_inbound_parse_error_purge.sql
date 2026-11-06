-- Remove an operator-selected ParseError row while retaining a minimal immutable
-- tombstone. The scanner skips the same content hash and registration stays blocked
-- until a valid newer file from the same path and LN is stored.
CREATE TABLE his_inbound_file_purge(
 sha256 text PRIMARY KEY CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 deleted_file_id uuid NOT NULL,
 source_path text NOT NULL CHECK(source_path ~* '^inbound/[0-9]{8}/[0-9]+-[0-9]+\.pet$'),
 ln text NOT NULL CHECK(ln ~ '^[0-9]+$'),
 path_version integer NOT NULL CHECK(path_version>0),
 actor_id uuid NOT NULL REFERENCES app_user,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX his_inbound_file_purge_path_ln ON his_inbound_file_purge(source_path,ln,path_version);
CREATE TRIGGER his_inbound_file_purge_immutable BEFORE UPDATE OR DELETE ON his_inbound_file_purge FOR EACH ROW EXECUTE FUNCTION immutable_row();

CREATE TABLE his_inbound_file_purge_event(
 sha256 text PRIMARY KEY REFERENCES his_inbound_file_purge,
 event text NOT NULL CHECK(event='SUPERSEDED'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION his_inbound_file_purge_event_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE p his_inbound_file_purge;
BEGIN
 -- Purge rows are immutable; the event primary key serializes duplicate supersession without a write-capable row lock.
 SELECT * INTO p FROM public.his_inbound_file_purge WHERE sha256=NEW.sha256;
 IF NOT FOUND OR NEW.event<>'SUPERSEDED' OR (
  NOT EXISTS(SELECT 1 FROM public.his_inbound_file f WHERE f.source_path=p.source_path AND f.ln=p.ln
   AND f.path_version>p.path_version AND f.state<>'ParseError')
  AND NOT EXISTS(SELECT 1 FROM public.his_inbound_source sighting
   JOIN public.his_inbound_file f ON f.id=sighting.inbound_file_id AND f.sha256=sighting.sha256
   WHERE sighting.source_path=p.source_path AND sighting.first_seen_at>p.created_at
    AND f.ln=p.ln AND f.state<>'ParseError')
 ) THEN RAISE EXCEPTION 'INBOUND_PURGE_REPLACEMENT_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER his_inbound_file_purge_event_guard BEFORE INSERT ON his_inbound_file_purge_event FOR EACH ROW EXECUTE FUNCTION his_inbound_file_purge_event_guard();
CREATE TRIGGER his_inbound_file_purge_event_immutable BEFORE UPDATE OR DELETE ON his_inbound_file_purge_event FOR EACH ROW EXECUTE FUNCTION immutable_row();

-- Keep immutable source sightings; unlink their FK only when the matching file row is purged.
ALTER TABLE his_inbound_source DROP CONSTRAINT his_inbound_source_inbound_file_id_fkey;
ALTER TABLE his_inbound_source ADD CONSTRAINT his_inbound_source_inbound_file_id_fkey
 FOREIGN KEY(inbound_file_id) REFERENCES his_inbound_file ON DELETE SET NULL;
DROP TRIGGER his_inbound_source_immutable ON his_inbound_source;
CREATE FUNCTION his_inbound_source_purge_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.inbound_file_id IS NOT NULL AND NEW.inbound_file_id IS NULL
   AND NEW.source_id=OLD.source_id AND NEW.source_path=OLD.source_path AND NEW.sha256=OLD.sha256
   AND NEW.byte_size=OLD.byte_size AND NEW.source_mtime=OLD.source_mtime
   AND EXISTS(SELECT 1 FROM public.his_inbound_file_purge p WHERE p.sha256=OLD.sha256 AND p.deleted_file_id=OLD.inbound_file_id)
  THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'INBOUND_SOURCE_IMMUTABLE';
END $$;
CREATE TRIGGER his_inbound_source_immutable BEFORE UPDATE OR DELETE ON his_inbound_source FOR EACH ROW EXECUTE FUNCTION his_inbound_source_purge_guard();

-- Existing review history is removed only as a consequence of deleting its ParseError parent.
ALTER TABLE his_inbound_file_event DROP CONSTRAINT his_inbound_file_event_inbound_file_id_fkey;
ALTER TABLE his_inbound_file_event ADD CONSTRAINT his_inbound_file_event_inbound_file_id_fkey
 FOREIGN KEY(inbound_file_id) REFERENCES his_inbound_file ON DELETE CASCADE;
DROP TRIGGER his_inbound_file_event_immutable ON his_inbound_file_event;
CREATE FUNCTION his_inbound_file_event_purge_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM public.his_inbound_file_purge p WHERE p.deleted_file_id=OLD.inbound_file_id) THEN RETURN OLD; END IF;
 END IF;
 RAISE EXCEPTION 'INBOUND_FILE_EVENT_IMMUTABLE';
END $$;
CREATE TRIGGER his_inbound_file_event_immutable BEFORE UPDATE OR DELETE ON his_inbound_file_event FOR EACH ROW EXECUTE FUNCTION his_inbound_file_event_purge_guard();

-- Serialize inserts and purges by content hash so a concurrent scan cannot recreate a purged row.
CREATE FUNCTION his_inbound_file_purge_insert_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(75432803,hashtext(NEW.sha256));
 IF EXISTS(SELECT 1 FROM public.his_inbound_file_purge p WHERE p.sha256=NEW.sha256) THEN RETURN NULL; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER his_inbound_file_purge_insert_guard BEFORE INSERT ON his_inbound_file FOR EACH ROW EXECUTE FUNCTION his_inbound_file_purge_insert_guard();

CREATE FUNCTION purge_his_inbound_parse_error(p_file_id uuid,p_actor_id uuid)
RETURNS TABLE(deleted_file_id uuid,sha256 text,source_path text,ln text,path_version integer,error_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE file_hash text; f his_inbound_file;
BEGIN
 SELECT source.sha256 INTO file_hash FROM public.his_inbound_file source WHERE source.id=p_file_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'INBOUND_FILE_NOT_FOUND'; END IF;
 PERFORM pg_advisory_xact_lock(75432803,hashtext(file_hash));
 SELECT source.* INTO f FROM public.his_inbound_file source WHERE source.id=p_file_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'INBOUND_FILE_NOT_FOUND'; END IF;
 IF f.sha256 IS DISTINCT FROM file_hash THEN RAISE EXCEPTION 'INBOUND_FILE_CHANGED'; END IF;
 IF f.state<>'ParseError' OR f.source_path IS NULL OR f.ln IS NULL OR f.path_version IS NULL THEN
  RAISE EXCEPTION 'PARSE_ERROR_ONLY';
 END IF;
 IF (SELECT e.event FROM public.his_inbound_file_event e WHERE e.inbound_file_id=f.id ORDER BY e.sequence DESC LIMIT 1)='SUPERSEDED' THEN
  RAISE EXCEPTION 'PARSE_ERROR_ALREADY_SUPERSEDED';
 END IF;
 IF EXISTS(SELECT 1 FROM public.his_inbound_file_purge p WHERE p.sha256=f.sha256) THEN
  RAISE EXCEPTION 'PARSE_ERROR_ALREADY_PURGED';
 END IF;
 INSERT INTO public.his_inbound_file_purge(sha256,deleted_file_id,source_path,ln,path_version,actor_id)
  VALUES(f.sha256,f.id,f.source_path,f.ln,f.path_version,p_actor_id);
 DELETE FROM public.his_inbound_file source WHERE source.id=f.id;
 RETURN QUERY SELECT f.id,f.sha256,f.source_path,f.ln,f.path_version,f.error_code;
END $$;
REVOKE ALL ON FUNCTION purge_his_inbound_parse_error(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON his_inbound_file_purge,his_inbound_file_purge_event FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN
  EXECUTE 'GRANT SELECT ON his_inbound_file_purge,his_inbound_file_purge_event TO app_rw';
  EXECUTE 'GRANT EXECUTE ON FUNCTION purge_his_inbound_parse_error(uuid,uuid) TO app_rw';
 END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='worker_rw') THEN
  EXECUTE 'GRANT SELECT ON his_inbound_file_purge,his_inbound_file_purge_event TO worker_rw';
  EXECUTE 'GRANT INSERT ON his_inbound_file_purge_event TO worker_rw';
 END IF;
END $$;
