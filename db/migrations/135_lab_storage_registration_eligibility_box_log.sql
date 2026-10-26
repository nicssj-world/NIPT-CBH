-- OWNER-LAB-051/052 (+ LEGACY LAB-UAT-003): forward-only. Applied migrations 122/126 are not edited.
-- 051: Backup and Buffy Coat become storable as soon as the round has an issued LN Halos; a PET receipt time is NOT a
--      precondition (it only drives the retention due date, which stays unknown without it).
-- 052: every box gets an immutable activity log written inside the SECURITY DEFINER storage functions, so no
--      application path can change a position or print a label without a log row. Existing history is backfilled.
--      No destruction workflow is created (not approved).
-- Replace (OWNER-LAB-003): two samples of the same type swap positions atomically; recorded as two MOVE movements.

CREATE TABLE lab_storage_box_event(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 box_id uuid NOT NULL REFERENCES lab_storage_box,
 event_type text NOT NULL CHECK(event_type IN ('BOX_CREATED','BOX_LABEL_PRINTED','BOX_LABEL_REPRINTED','SAMPLE_LABEL_PRINTED','SAMPLE_LABEL_REPRINTED',
  'SAMPLE_PLACED','SAMPLE_MOVED_IN','SAMPLE_MOVED_OUT','SAMPLE_MOVED_WITHIN','SAMPLE_REPLACED')),
 round_id uuid REFERENCES specimen_round,
 storage_type text CHECK(storage_type IN ('BACKUP','BUFFY_COAT')),
 slot integer CHECK(slot BETWEEN 1 AND 81),
 related_box_id uuid REFERENCES lab_storage_box,
 related_slot integer CHECK(related_slot BETWEEN 1 AND 81),
 actor_id uuid NOT NULL REFERENCES app_user,
 source text NOT NULL DEFAULT 'SYSTEM' CHECK(source IN ('SYSTEM','BACKFILL')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX lab_storage_box_event_box ON lab_storage_box_event(box_id,created_at,sequence);
CREATE INDEX lab_storage_box_event_round ON lab_storage_box_event(round_id,created_at);
CREATE TRIGGER lab_storage_box_event_immutable BEFORE UPDATE OR DELETE ON lab_storage_box_event FOR EACH ROW EXECUTE FUNCTION immutable_row();

-- Backfill (source=BACKFILL keeps original actor and time).
INSERT INTO lab_storage_box_event(box_id,event_type,actor_id,source,created_at)
 SELECT b.id,'BOX_CREATED',b.created_by,'BACKFILL',b.created_at FROM lab_storage_box b;
INSERT INTO lab_storage_box_event(box_id,event_type,round_id,storage_type,slot,actor_id,source,created_at)
 SELECT m.to_box_id,'SAMPLE_PLACED',m.round_id,m.storage_type,m.to_slot,m.actor_id,'BACKFILL',m.created_at FROM lab_storage_movement m WHERE m.event_type='PLACE';
INSERT INTO lab_storage_box_event(box_id,event_type,round_id,storage_type,slot,related_box_id,related_slot,actor_id,source,created_at)
 SELECT m.to_box_id,CASE WHEN m.from_box_id=m.to_box_id THEN 'SAMPLE_MOVED_WITHIN' ELSE 'SAMPLE_MOVED_IN' END,m.round_id,m.storage_type,m.to_slot,m.from_box_id,m.from_slot,m.actor_id,'BACKFILL',m.created_at
 FROM lab_storage_movement m WHERE m.event_type='MOVE';
INSERT INTO lab_storage_box_event(box_id,event_type,round_id,storage_type,slot,related_box_id,related_slot,actor_id,source,created_at)
 SELECT m.from_box_id,'SAMPLE_MOVED_OUT',m.round_id,m.storage_type,m.from_slot,m.to_box_id,m.to_slot,m.actor_id,'BACKFILL',m.created_at
 FROM lab_storage_movement m WHERE m.event_type='MOVE' AND m.from_box_id<>m.to_box_id;
INSERT INTO lab_storage_box_event(box_id,event_type,actor_id,source,created_at)
 SELECT b.id,CASE WHEN row_number() OVER(PARTITION BY b.id ORDER BY a.sequence)=1 THEN 'BOX_LABEL_PRINTED' ELSE 'BOX_LABEL_REPRINTED' END,a.actor_id,'BACKFILL',a.created_at
 FROM audit_chain a JOIN lab_storage_box b ON b.id=a.resource_id
 WHERE a.action='LAB_STORAGE_LABEL_PRINTED' AND a.resource_type='lab_storage_box' AND a.actor_id IS NOT NULL;

-- Swaps need both rows to hold the other's slot inside one statement sequence.
ALTER TABLE lab_storage_typed_position DROP CONSTRAINT lab_storage_typed_position_box_id_slot_key;
ALTER TABLE lab_storage_typed_position ADD CONSTRAINT lab_storage_typed_position_box_id_slot_key UNIQUE(box_id,slot) DEFERRABLE INITIALLY IMMEDIATE;

CREATE OR REPLACE FUNCTION lab_storage_create_box(p_box_type text,p_actor uuid)
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
 INSERT INTO public.lab_storage_box_event(box_id,event_type,actor_id) VALUES(new_id,'BOX_CREATED',p_actor);
 RETURN QUERY SELECT new_id,new_label,p_box_type;
END $$;

-- Eligibility: issued LN Halos, round not cancelled, not a historical case. received_at/received_source are no longer required.
CREATE OR REPLACE FUNCTION lab_storage_set_position(
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
  WHERE r.id=p_round_id AND r.state<>'Cancelled' AND c.registration_origin<>'HISTORICAL' AND n.ln_halos IS NOT NULL
 ) THEN RAISE EXCEPTION 'STORAGE_SAMPLE_NOT_ELIGIBLE'; END IF;

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
  INSERT INTO public.lab_storage_box_event(box_id,event_type,round_id,storage_type,slot,actor_id)
   VALUES(p_target_box_id,'SAMPLE_PLACED',p_round_id,p_storage_type,p_target_slot,p_actor);
 ELSE
  PERFORM set_config('nipt.storage_write_tx',txid_current()::text,true);
  UPDATE public.lab_storage_typed_position SET box_id=p_target_box_id,slot=p_target_slot,stored_by=p_actor,stored_at=clock_timestamp()
   WHERE id=current_row.id;
  INSERT INTO public.lab_storage_movement(position_id,round_id,storage_type,event_type,from_box_id,from_slot,to_box_id,to_slot,actor_id)
   VALUES(current_row.id,p_round_id,p_storage_type,'MOVE',current_row.box_id,current_row.slot,p_target_box_id,p_target_slot,p_actor);
  IF current_row.box_id=p_target_box_id THEN
   INSERT INTO public.lab_storage_box_event(box_id,event_type,round_id,storage_type,slot,related_box_id,related_slot,actor_id)
    VALUES(p_target_box_id,'SAMPLE_MOVED_WITHIN',p_round_id,p_storage_type,p_target_slot,current_row.box_id,current_row.slot,p_actor);
  ELSE
   INSERT INTO public.lab_storage_box_event(box_id,event_type,round_id,storage_type,slot,related_box_id,related_slot,actor_id)
    VALUES(current_row.box_id,'SAMPLE_MOVED_OUT',p_round_id,p_storage_type,current_row.slot,p_target_box_id,p_target_slot,p_actor),
          (p_target_box_id,'SAMPLE_MOVED_IN',p_round_id,p_storage_type,p_target_slot,current_row.box_id,current_row.slot,p_actor);
  END IF;
 END IF;
 position_id:=new_id;changed:=did_change;RETURN NEXT;
END $$;

-- Replace: swap the stored positions of two samples of one storage type (each caller-observed position must still be current).
CREATE FUNCTION lab_storage_swap(p_round_a uuid,p_round_b uuid,p_storage_type text,p_box_a uuid,p_slot_a integer,p_box_b uuid,p_slot_b integer,p_actor uuid)
RETURNS TABLE(position_a uuid,position_b uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a public.lab_storage_typed_position; b public.lab_storage_typed_position;
BEGIN
 IF p_storage_type NOT IN ('BACKUP','BUFFY_COAT') THEN RAISE EXCEPTION 'STORAGE_BOX_TYPE_INVALID'; END IF;
 IF p_round_a=p_round_b THEN RAISE EXCEPTION 'STORAGE_SWAP_SAME_SAMPLE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.app_user WHERE app_user.id=p_actor AND app_user.enabled) THEN RAISE EXCEPTION 'STORAGE_ACTOR_INVALID'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sample-storage:'||p_storage_type,75432832));
 PERFORM pg_advisory_xact_lock(hashtextextended(least(p_box_a,p_box_b)::text,75432833));
 IF p_box_a<>p_box_b THEN PERFORM pg_advisory_xact_lock(hashtextextended(greatest(p_box_a,p_box_b)::text,75432833)); END IF;
 SELECT p.* INTO a FROM public.lab_storage_typed_position p WHERE p.round_id=p_round_a AND p.storage_type=p_storage_type FOR UPDATE;
 SELECT p.* INTO b FROM public.lab_storage_typed_position p WHERE p.round_id=p_round_b AND p.storage_type=p_storage_type FOR UPDATE;
 IF a.id IS NULL OR b.id IS NULL THEN RAISE EXCEPTION 'STORAGE_SWAP_NOT_STORED'; END IF;
 IF a.box_id<>p_box_a OR a.slot<>p_slot_a OR b.box_id<>p_box_b OR b.slot<>p_slot_b THEN RAISE EXCEPTION 'STORAGE_MOVE_STALE'; END IF;
 SET CONSTRAINTS lab_storage_typed_position_box_id_slot_key DEFERRED;
 PERFORM set_config('nipt.storage_write_tx',txid_current()::text,true);
 UPDATE public.lab_storage_typed_position SET box_id=b.box_id,slot=b.slot,stored_by=p_actor,stored_at=clock_timestamp() WHERE id=a.id;
 UPDATE public.lab_storage_typed_position SET box_id=a.box_id,slot=a.slot,stored_by=p_actor,stored_at=clock_timestamp() WHERE id=b.id;
 SET CONSTRAINTS lab_storage_typed_position_box_id_slot_key IMMEDIATE;
 INSERT INTO public.lab_storage_movement(position_id,round_id,storage_type,event_type,from_box_id,from_slot,to_box_id,to_slot,actor_id)
  VALUES(a.id,a.round_id,p_storage_type,'MOVE',a.box_id,a.slot,b.box_id,b.slot,p_actor),
        (b.id,b.round_id,p_storage_type,'MOVE',b.box_id,b.slot,a.box_id,a.slot,p_actor);
 INSERT INTO public.lab_storage_box_event(box_id,event_type,round_id,storage_type,slot,related_box_id,related_slot,actor_id)
  VALUES(b.box_id,'SAMPLE_REPLACED',a.round_id,p_storage_type,b.slot,a.box_id,a.slot,p_actor),
        (a.box_id,'SAMPLE_REPLACED',b.round_id,p_storage_type,a.slot,b.box_id,b.slot,p_actor);
 position_a:=a.id;position_b:=b.id;RETURN NEXT;
END $$;

-- Label printing evidence (first print vs reprint is derived from the box's own log, never from a client flag).
CREATE FUNCTION lab_storage_log_label(p_box_id uuid,p_round_id uuid,p_storage_type text,p_actor uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE kind text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.app_user WHERE app_user.id=p_actor AND app_user.enabled) THEN RAISE EXCEPTION 'STORAGE_ACTOR_INVALID'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.lab_storage_box WHERE id=p_box_id) THEN RAISE EXCEPTION 'STORAGE_BOX_NOT_FOUND'; END IF;
 IF p_round_id IS NULL THEN
  kind:=CASE WHEN EXISTS(SELECT 1 FROM public.lab_storage_box_event WHERE box_id=p_box_id AND event_type IN ('BOX_LABEL_PRINTED','BOX_LABEL_REPRINTED')) THEN 'BOX_LABEL_REPRINTED' ELSE 'BOX_LABEL_PRINTED' END;
  INSERT INTO public.lab_storage_box_event(box_id,event_type,actor_id) VALUES(p_box_id,kind,p_actor);
 ELSE
  IF p_storage_type NOT IN ('BACKUP','BUFFY_COAT') THEN RAISE EXCEPTION 'STORAGE_BOX_TYPE_INVALID'; END IF;
  kind:=CASE WHEN EXISTS(SELECT 1 FROM public.lab_storage_box_event WHERE round_id=p_round_id AND storage_type=p_storage_type AND event_type IN ('SAMPLE_LABEL_PRINTED','SAMPLE_LABEL_REPRINTED')) THEN 'SAMPLE_LABEL_REPRINTED' ELSE 'SAMPLE_LABEL_PRINTED' END;
  INSERT INTO public.lab_storage_box_event(box_id,event_type,round_id,storage_type,slot,actor_id)
   SELECT p_box_id,kind,p_round_id,p_storage_type,p.slot,p_actor FROM public.lab_storage_typed_position p
   WHERE p.round_id=p_round_id AND p.storage_type=p_storage_type AND p.box_id=p_box_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'STORAGE_SAMPLE_NOT_IN_BOX'; END IF;
 END IF;
 RETURN kind;
END $$;

REVOKE ALL ON FUNCTION lab_storage_swap(uuid,uuid,text,uuid,integer,uuid,integer,uuid),lab_storage_log_label(uuid,uuid,text,uuid) FROM PUBLIC;
-- Grants also for databases whose app role was created after migration 126 ran (the fresh-install order that left the
-- Owner UAT without SELECT on lab_storage_typed_position). packages/db/roles.sql carries the same grants for new installs.
DO $$ BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN
 REVOKE INSERT,UPDATE,DELETE ON lab_storage_box,lab_storage_position,lab_storage_typed_position,lab_storage_movement,lab_storage_box_event FROM app_rw;
 REVOKE USAGE,SELECT ON SEQUENCE lab_storage_box_box_number_seq FROM app_rw;
 GRANT SELECT ON lab_storage_box,lab_storage_position,lab_storage_typed_position,lab_storage_movement,lab_storage_box_event TO app_rw;
 GRANT EXECUTE ON FUNCTION lab_storage_create_box(text,uuid),lab_storage_set_position(uuid,text,uuid,integer,uuid,uuid,integer),
  lab_storage_swap(uuid,uuid,text,uuid,integer,uuid,integer,uuid),lab_storage_log_label(uuid,uuid,text,uuid) TO app_rw;
END IF; END $$;
