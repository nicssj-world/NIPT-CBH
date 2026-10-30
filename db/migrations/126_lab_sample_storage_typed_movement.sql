-- LAB-UAT-003: typed Backup/Buffy Coat storage with current-position guards and immutable movement history.
-- Existing generic boxes and positions remain readable and are never assigned a type by this migration.
ALTER TABLE lab_storage_box
 ADD COLUMN box_type text NOT NULL DEFAULT 'LEGACY_UNCLASSIFIED',
 ADD CONSTRAINT lab_storage_box_type_check CHECK(box_type IN ('BACKUP','BUFFY_COAT','LEGACY_UNCLASSIFIED')),
 ADD CONSTRAINT lab_storage_box_id_type_unique UNIQUE(id,box_type);

CREATE TABLE lab_storage_typed_position(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 round_id uuid NOT NULL REFERENCES specimen_round,
 storage_type text NOT NULL CHECK(storage_type IN ('BACKUP','BUFFY_COAT')),
 box_id uuid NOT NULL,
 slot integer NOT NULL CHECK(slot BETWEEN 1 AND 81),
 stored_by uuid NOT NULL REFERENCES app_user,
 stored_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(round_id,storage_type),
 UNIQUE(box_id,slot),
 FOREIGN KEY(box_id,storage_type) REFERENCES lab_storage_box(id,box_type)
);

CREATE TABLE lab_storage_movement(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 position_id uuid NOT NULL REFERENCES lab_storage_typed_position,
 round_id uuid NOT NULL REFERENCES specimen_round,
 storage_type text NOT NULL CHECK(storage_type IN ('BACKUP','BUFFY_COAT')),
 event_type text NOT NULL CHECK(event_type IN ('PLACE','MOVE')),
 from_box_id uuid REFERENCES lab_storage_box,
 from_slot integer CHECK(from_slot BETWEEN 1 AND 81),
 to_box_id uuid NOT NULL REFERENCES lab_storage_box,
 to_slot integer NOT NULL CHECK(to_slot BETWEEN 1 AND 81),
 actor_id uuid NOT NULL REFERENCES app_user,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((from_box_id IS NULL)=(from_slot IS NULL)),
 CHECK((event_type='PLACE' AND from_box_id IS NULL) OR (event_type='MOVE' AND from_box_id IS NOT NULL))
);

CREATE INDEX lab_storage_movement_round ON lab_storage_movement(round_id,storage_type,created_at,id);
CREATE INDEX lab_storage_typed_position_box ON lab_storage_typed_position(box_id,slot);

CREATE FUNCTION lab_storage_current_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'LAB_STORAGE_POSITION_DELETE_PROHIBITED'; END IF;
 IF current_setting('nipt.storage_write_tx',true) IS DISTINCT FROM txid_current()::text THEN
  RAISE EXCEPTION 'LAB_STORAGE_POSITION_WRITE_REQUIRES_COMMAND';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lab_storage_typed_position_guard BEFORE UPDATE OR DELETE ON lab_storage_typed_position FOR EACH ROW EXECUTE FUNCTION lab_storage_current_guard();
CREATE TRIGGER lab_storage_movement_immutable BEFORE UPDATE OR DELETE ON lab_storage_movement FOR EACH ROW EXECUTE FUNCTION immutable_row();

CREATE FUNCTION lab_storage_create_box(p_box_type text,p_actor uuid)
RETURNS TABLE(id uuid,box_id text,box_type text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE box_no bigint; new_id uuid; new_label text;
BEGIN
 IF p_box_type NOT IN ('BACKUP','BUFFY_COAT') THEN RAISE EXCEPTION 'STORAGE_BOX_TYPE_INVALID'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.app_user WHERE app_user.id=p_actor AND app_user.enabled) THEN RAISE EXCEPTION 'STORAGE_ACTOR_INVALID'; END IF;
 box_no:=nextval('public.lab_storage_box_box_number_seq'::regclass);
 new_id:=gen_random_uuid();
 new_label:='Box'||lpad(box_no::text,3,'0');
 INSERT INTO public.lab_storage_box(id,box_number,box_id,created_by,box_type)
  OVERRIDING SYSTEM VALUE VALUES(new_id,box_no,new_label,p_actor,p_box_type);
 RETURN QUERY SELECT new_id,new_label,p_box_type;
END $$;

CREATE FUNCTION lab_storage_set_position(
 p_round_id uuid,p_storage_type text,p_target_box_id uuid,p_target_slot integer,p_actor uuid,
 p_expected_box_id uuid DEFAULT NULL,p_expected_slot integer DEFAULT NULL
) RETURNS TABLE(position_id uuid,changed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_row public.lab_storage_typed_position; target_type text; occupied_id uuid; new_id uuid; did_change boolean:=true;
BEGIN
 IF p_storage_type NOT IN ('BACKUP','BUFFY_COAT') THEN RAISE EXCEPTION 'STORAGE_BOX_TYPE_INVALID'; END IF;
 IF p_target_slot IS NULL OR p_target_slot NOT BETWEEN 1 AND 81 THEN RAISE EXCEPTION 'STORAGE_SLOT_INVALID'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.app_user WHERE app_user.id=p_actor AND app_user.enabled) THEN RAISE EXCEPTION 'STORAGE_ACTOR_INVALID'; END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended('sample-storage:'||p_storage_type,75432832));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_target_box_id::text,75432833));
 SELECT b.box_type INTO target_type FROM public.lab_storage_box b WHERE b.id=p_target_box_id;
 IF target_type IS NULL THEN RAISE EXCEPTION 'STORAGE_BOX_NOT_FOUND'; END IF;
 IF target_type<>p_storage_type THEN RAISE EXCEPTION 'STORAGE_BOX_TYPE_MISMATCH'; END IF;
 IF EXISTS(SELECT 1 FROM public.lab_storage_position WHERE round_id=p_round_id) THEN RAISE EXCEPTION 'STORAGE_LEGACY_UNCLASSIFIED'; END IF;
 IF NOT EXISTS(
  SELECT 1 FROM public.specimen_round_current r JOIN public.nipt_case c ON c.id=r.case_id
   JOIN public.specimen_lab_number n ON n.round_id=r.id
  WHERE r.id=p_round_id AND r.received_at IS NOT NULL AND r.received_source IS NOT NULL
   AND r.state<>'Cancelled' AND c.registration_origin<>'HISTORICAL' AND n.ln_halos IS NOT NULL
 ) THEN RAISE EXCEPTION 'STORAGE_SAMPLE_NOT_RECEIVED'; END IF;

 SELECT p.* INTO current_row FROM public.lab_storage_typed_position p
  WHERE p.round_id=p_round_id AND p.storage_type=p_storage_type FOR UPDATE;
 IF current_row.id IS NOT NULL THEN
  IF p_expected_box_id IS NULL OR p_expected_slot IS NULL THEN
   IF current_row.box_id=p_target_box_id AND current_row.slot=p_target_slot THEN
    position_id:=current_row.id;changed:=false;RETURN NEXT;RETURN;
   END IF;
   RAISE EXCEPTION 'STORAGE_POSITION_OCCUPIED';
  END IF;
  IF current_row.box_id<>p_expected_box_id OR current_row.slot<>p_expected_slot THEN RAISE EXCEPTION 'STORAGE_MOVE_STALE'; END IF;
  IF current_row.box_id=p_target_box_id AND current_row.slot=p_target_slot THEN
   position_id:=current_row.id;changed:=false;RETURN NEXT;RETURN;
  END IF;
  new_id:=current_row.id;
 ELSE
  IF p_expected_box_id IS NOT NULL OR p_expected_slot IS NOT NULL THEN RAISE EXCEPTION 'STORAGE_MOVE_STALE'; END IF;
  new_id:=gen_random_uuid();
 END IF;

 SELECT p.id INTO occupied_id FROM public.lab_storage_typed_position p
  WHERE p.box_id=p_target_box_id AND p.slot=p_target_slot FOR UPDATE;
 IF occupied_id IS NOT NULL AND occupied_id<>new_id THEN RAISE EXCEPTION 'STORAGE_POSITION_OCCUPIED'; END IF;
 IF EXISTS(SELECT 1 FROM public.lab_storage_position p WHERE p.box_id=p_target_box_id AND p.slot=p_target_slot) THEN
  RAISE EXCEPTION 'STORAGE_POSITION_OCCUPIED';
 END IF;
 IF current_row.id IS NULL THEN
  INSERT INTO public.lab_storage_typed_position(id,round_id,storage_type,box_id,slot,stored_by)
   VALUES(new_id,p_round_id,p_storage_type,p_target_box_id,p_target_slot,p_actor);
  INSERT INTO public.lab_storage_movement(position_id,round_id,storage_type,event_type,to_box_id,to_slot,actor_id)
   VALUES(new_id,p_round_id,p_storage_type,'PLACE',p_target_box_id,p_target_slot,p_actor);
 ELSE
  PERFORM set_config('nipt.storage_write_tx',txid_current()::text,true);
  UPDATE public.lab_storage_typed_position SET box_id=p_target_box_id,slot=p_target_slot,stored_by=p_actor,stored_at=clock_timestamp()
   WHERE id=current_row.id;
  INSERT INTO public.lab_storage_movement(position_id,round_id,storage_type,event_type,from_box_id,from_slot,to_box_id,to_slot,actor_id)
   VALUES(current_row.id,p_round_id,p_storage_type,'MOVE',current_row.box_id,current_row.slot,p_target_box_id,p_target_slot,p_actor);
 END IF;
 position_id:=new_id;changed:=did_change;RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION lab_storage_create_box(text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION lab_storage_set_position(uuid,text,uuid,integer,uuid,uuid,integer) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN
 REVOKE INSERT,UPDATE,DELETE ON lab_storage_box,lab_storage_position FROM app_rw;
 REVOKE INSERT,UPDATE,DELETE ON lab_storage_typed_position,lab_storage_movement FROM app_rw;
 REVOKE USAGE,SELECT ON SEQUENCE lab_storage_box_box_number_seq FROM app_rw;
 GRANT SELECT ON lab_storage_box,lab_storage_position,lab_storage_typed_position,lab_storage_movement TO app_rw;
 GRANT EXECUTE ON FUNCTION lab_storage_create_box(text,uuid),lab_storage_set_position(uuid,text,uuid,integer,uuid,uuid,integer) TO app_rw;
END IF; END $$;
