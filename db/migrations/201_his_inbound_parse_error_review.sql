-- Parse errors can be hidden from the active list without deleting source evidence or bypassing the registration guard.
CREATE TABLE his_inbound_file_event(
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 inbound_file_id uuid NOT NULL REFERENCES his_inbound_file,
 event text NOT NULL CHECK(event IN ('DISMISSED','RESTORED','SUPERSEDED')),
 actor_id uuid REFERENCES app_user,
 reason_code text NOT NULL CHECK(reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((event='SUPERSEDED' AND actor_id IS NULL AND reason_code='VALID_REPLACEMENT') OR
       (event IN ('DISMISSED','RESTORED') AND actor_id IS NOT NULL AND reason_code='OPERATOR_ACTION'))
);
CREATE INDEX his_inbound_file_event_latest ON his_inbound_file_event(inbound_file_id,sequence DESC);

CREATE FUNCTION his_inbound_file_event_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE f public.his_inbound_file; latest text;
BEGIN
 IF public.p3_worker_session() AND (NEW.event<>'SUPERSEDED' OR NEW.actor_id IS NOT NULL OR NEW.reason_code<>'VALID_REPLACEMENT') THEN
  RAISE EXCEPTION 'WORKER_FILE_REVIEW_EVENT_PROHIBITED';
 END IF;
 SELECT * INTO f FROM public.his_inbound_file WHERE id=NEW.inbound_file_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'INBOUND_FILE_NOT_FOUND'; END IF;
 SELECT event INTO latest FROM public.his_inbound_file_event WHERE inbound_file_id=NEW.inbound_file_id ORDER BY sequence DESC LIMIT 1;
 IF NEW.event='DISMISSED' THEN
  IF f.state<>'ParseError' OR latest IN ('DISMISSED','SUPERSEDED') THEN RAISE EXCEPTION 'PARSE_ERROR_NOT_DISMISSIBLE'; END IF;
 ELSIF NEW.event='RESTORED' THEN
  IF f.state<>'ParseError' OR latest IS DISTINCT FROM 'DISMISSED' THEN RAISE EXCEPTION 'PARSE_ERROR_NOT_RESTORABLE'; END IF;
 ELSIF NEW.event='SUPERSEDED' THEN
  IF f.state<>'ParseError' OR latest='SUPERSEDED' OR NOT EXISTS(
   SELECT 1 FROM public.his_inbound_file replacement
   WHERE replacement.source_path=f.source_path AND replacement.ln=f.ln
    AND replacement.path_version>f.path_version AND replacement.state<>'ParseError'
  ) AND NOT EXISTS(
   SELECT 1 FROM public.his_inbound_source sighting
   JOIN public.his_inbound_file replacement ON replacement.id=sighting.inbound_file_id AND replacement.sha256=sighting.sha256
   WHERE sighting.source_path=f.source_path AND sighting.first_seen_at>f.discovered_at
    AND replacement.ln=f.ln AND replacement.state<>'ParseError'
  ) THEN RAISE EXCEPTION 'PARSE_ERROR_REPLACEMENT_REQUIRED'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER his_inbound_file_event_guard BEFORE INSERT ON his_inbound_file_event FOR EACH ROW EXECUTE FUNCTION public.his_inbound_file_event_guard();
CREATE TRIGGER his_inbound_file_event_immutable BEFORE UPDATE OR DELETE ON his_inbound_file_event FOR EACH ROW EXECUTE FUNCTION public.immutable_row();

REVOKE ALL ON his_inbound_file_event FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN
  EXECUTE 'GRANT SELECT,INSERT ON his_inbound_file_event TO app_rw';
  EXECUTE 'GRANT USAGE ON SEQUENCE his_inbound_file_event_sequence_seq TO app_rw';
 END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='worker_rw') THEN
  EXECUTE 'GRANT SELECT,INSERT ON his_inbound_file_event TO worker_rw';
  EXECUTE 'GRANT USAGE ON SEQUENCE his_inbound_file_event_sequence_seq TO worker_rw';
 END IF;
END $$;
