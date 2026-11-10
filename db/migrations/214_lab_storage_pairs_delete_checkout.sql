-- Owner 2026-11-10 (sample storage): forward-only; applied migrations 122/126/135 are not edited.
--  1. Box numbers count per type: Backup Box 1, 2, 3 … and Buffy Coat Box 1, 2, 3 …, so the pair of one number belongs together.
--     Existing typed boxes are renumbered by their creation order within their type (history keeps the box uuid, only the shown number changes).
--  2. A box is deleted by marking it (deleted_at/by/reason): the table keeps its rows and history; only an EMPTY box can be marked.
--  3. A stored sample can be checked out with a reason and returned; the slot stays reserved and every step is an immutable row + box log event.

ALTER TABLE lab_storage_box
 ADD COLUMN type_number integer,
 ADD COLUMN deleted_at timestamptz,
 ADD COLUMN deleted_by uuid REFERENCES app_user,
 ADD COLUMN delete_reason text,
 ADD CONSTRAINT lab_storage_box_deleted_pair CHECK((deleted_at IS NULL)=(deleted_by IS NULL)),
 ADD CONSTRAINT lab_storage_box_type_number_positive CHECK(type_number IS NULL OR type_number>0);

-- Same label (Box001) may now exist once per type.
DO $$ DECLARE c text; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.lab_storage_box'::regclass AND contype='u' AND pg_get_constraintdef(oid)='UNIQUE (box_id)' LOOP
  EXECUTE format('ALTER TABLE public.lab_storage_box DROP CONSTRAINT %I',c);
 END LOOP;
END $$;

DROP TRIGGER lab_storage_box_immutable ON lab_storage_box;
UPDATE lab_storage_box b SET type_number=r.n,box_id='Box'||lpad(r.n::text,3,'0')
 FROM (SELECT id,row_number() OVER(PARTITION BY box_type ORDER BY box_number)::int n FROM lab_storage_box WHERE box_type IN ('BACKUP','BUFFY_COAT')) r
 WHERE b.id=r.id;
ALTER TABLE lab_storage_box ADD CONSTRAINT lab_storage_box_box_id_type_key UNIQUE(box_id,box_type);
CREATE UNIQUE INDEX lab_storage_box_type_number ON lab_storage_box(box_type,type_number) WHERE type_number IS NOT NULL;

-- Rows stay (never deleted); only the three deletion columns may change, once, through lab_storage_delete_box.
CREATE FUNCTION lab_storage_box_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'LAB_STORAGE_BOX_DELETE_PROHIBITED'; END IF;
 IF (to_jsonb(NEW)-'deleted_at'-'deleted_by'-'delete_reason') IS DISTINCT FROM (to_jsonb(OLD)-'deleted_at'-'deleted_by'-'delete_reason') THEN RAISE EXCEPTION 'LAB_STORAGE_BOX_IMMUTABLE'; END IF;
 IF OLD.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'LAB_STORAGE_BOX_ALREADY_DELETED'; END IF;
 IF current_setting('nipt.storage_write_tx',true) IS DISTINCT FROM txid_current()::text THEN RAISE EXCEPTION 'LAB_STORAGE_BOX_WRITE_REQUIRES_COMMAND'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lab_storage_box_guard BEFORE UPDATE OR DELETE ON lab_storage_box FOR EACH ROW EXECUTE FUNCTION lab_storage_box_guard();

-- Check-out / return of a stored sample (append-only; the latest row per position is its state).
CREATE TABLE lab_storage_checkout(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 position_id uuid NOT NULL REFERENCES lab_storage_typed_position,
 round_id uuid NOT NULL REFERENCES specimen_round,
 storage_type text NOT NULL CHECK(storage_type IN ('BACKUP','BUFFY_COAT')),
 box_id uuid NOT NULL REFERENCES lab_storage_box,
 slot integer NOT NULL CHECK(slot BETWEEN 1 AND 81),
 event text NOT NULL CHECK(event IN ('CHECK_OUT','RETURN')),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
 actor_id uuid NOT NULL REFERENCES app_user,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX lab_storage_checkout_position ON lab_storage_checkout(position_id,sequence DESC);
CREATE INDEX lab_storage_checkout_box ON lab_storage_checkout(box_id,sequence DESC);
CREATE TRIGGER lab_storage_checkout_immutable BEFORE UPDATE OR DELETE ON lab_storage_checkout FOR EACH ROW EXECUTE FUNCTION immutable_row();

-- New box log events.
DO $$ DECLARE c text; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.lab_storage_box_event'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%SAMPLE_PLACED%' LOOP
  EXECUTE format('ALTER TABLE public.lab_storage_box_event DROP CONSTRAINT %I',c);
 END LOOP;
END $$;
ALTER TABLE lab_storage_box_event ADD CONSTRAINT lab_storage_box_event_type_check CHECK(event_type IN ('BOX_CREATED','BOX_LABEL_PRINTED','BOX_LABEL_REPRINTED','SAMPLE_LABEL_PRINTED','SAMPLE_LABEL_REPRINTED',
 'SAMPLE_PLACED','SAMPLE_MOVED_IN','SAMPLE_MOVED_OUT','SAMPLE_MOVED_WITHIN','SAMPLE_REPLACED','BOX_DELETED','SAMPLE_CHECKED_OUT','SAMPLE_RETURNED'));

-- A position can neither enter a deleted box nor leave its slot while its sample is checked out (covers set_position and swap alike).
CREATE FUNCTION lab_storage_position_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.lab_storage_box b WHERE b.id=NEW.box_id AND b.deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'STORAGE_BOX_DELETED'; END IF;
 IF TG_OP='UPDATE' AND (OLD.box_id<>NEW.box_id OR OLD.slot<>NEW.slot)
  AND (SELECT c.event FROM public.lab_storage_checkout c WHERE c.position_id=OLD.id ORDER BY c.sequence DESC LIMIT 1)='CHECK_OUT' THEN RAISE EXCEPTION 'STORAGE_SAMPLE_CHECKED_OUT'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lab_storage_position_guard BEFORE INSERT OR UPDATE ON lab_storage_typed_position FOR EACH ROW EXECUTE FUNCTION lab_storage_position_guard();

-- Box numbers per type (a number is never reused: deleted boxes keep their row and their number).
CREATE OR REPLACE FUNCTION lab_storage_create_box(p_box_type text,p_actor uuid)
RETURNS TABLE(id uuid,box_id text,box_type text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE box_no bigint; new_id uuid; n integer; new_label text;
BEGIN
 IF p_box_type NOT IN ('BACKUP','BUFFY_COAT') THEN RAISE EXCEPTION 'STORAGE_BOX_TYPE_INVALID'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.app_user WHERE app_user.id=p_actor AND app_user.enabled) THEN RAISE EXCEPTION 'STORAGE_ACTOR_INVALID'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sample-storage-box-number',75432834));
 n:=COALESCE((SELECT max(b.type_number) FROM public.lab_storage_box b WHERE b.box_type=p_box_type),0)+1;
 box_no:=nextval('public.lab_storage_box_box_number_seq'::regclass);
 new_id:=gen_random_uuid();
 new_label:='Box'||lpad(n::text,3,'0');
 INSERT INTO public.lab_storage_box(id,box_number,box_id,created_by,box_type,type_number)
  OVERRIDING SYSTEM VALUE VALUES(new_id,box_no,new_label,p_actor,p_box_type,n);
 INSERT INTO public.lab_storage_box_event(box_id,event_type,actor_id) VALUES(new_id,'BOX_CREATED',p_actor);
 RETURN QUERY SELECT new_id,new_label,p_box_type;
END $$;

-- One call opens the Backup box and the Buffy Coat box of the same number.
CREATE FUNCTION lab_storage_create_pair(p_actor uuid)
RETURNS TABLE(id uuid,box_id text,box_type text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE n integer; new_label text; t text; new_id uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.app_user WHERE app_user.id=p_actor AND app_user.enabled) THEN RAISE EXCEPTION 'STORAGE_ACTOR_INVALID'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sample-storage-box-number',75432834));
 n:=COALESCE((SELECT max(b.type_number) FROM public.lab_storage_box b WHERE b.box_type IN ('BACKUP','BUFFY_COAT')),0)+1;
 new_label:='Box'||lpad(n::text,3,'0');
 FOREACH t IN ARRAY ARRAY['BACKUP','BUFFY_COAT'] LOOP
  new_id:=gen_random_uuid();
  INSERT INTO public.lab_storage_box(id,box_number,box_id,created_by,box_type,type_number)
   OVERRIDING SYSTEM VALUE VALUES(new_id,nextval('public.lab_storage_box_box_number_seq'::regclass),new_label,p_actor,t,n);
  INSERT INTO public.lab_storage_box_event(box_id,event_type,actor_id) VALUES(new_id,'BOX_CREATED',p_actor);
  id:=new_id;box_id:=new_label;box_type:=t;RETURN NEXT;
 END LOOP;
END $$;

-- Only an empty box can be deleted (marked).
CREATE FUNCTION lab_storage_delete_box(p_box_id uuid,p_actor uuid,p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE b public.lab_storage_box;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.app_user WHERE app_user.id=p_actor AND app_user.enabled) THEN RAISE EXCEPTION 'STORAGE_ACTOR_INVALID'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_box_id::text,75432833));
 SELECT * INTO b FROM public.lab_storage_box WHERE id=p_box_id FOR UPDATE;
 IF b.id IS NULL THEN RAISE EXCEPTION 'STORAGE_BOX_NOT_FOUND'; END IF;
 IF b.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'STORAGE_BOX_ALREADY_DELETED'; END IF;
 IF EXISTS(SELECT 1 FROM public.lab_storage_typed_position WHERE box_id=p_box_id) OR EXISTS(SELECT 1 FROM public.lab_storage_position WHERE box_id=p_box_id) THEN RAISE EXCEPTION 'STORAGE_BOX_NOT_EMPTY'; END IF;
 PERFORM set_config('nipt.storage_write_tx',txid_current()::text,true);
 UPDATE public.lab_storage_box SET deleted_at=clock_timestamp(),deleted_by=p_actor,delete_reason=left(COALESCE(NULLIF(trim(p_reason),''),'-'),300) WHERE id=p_box_id;
 INSERT INTO public.lab_storage_box_event(box_id,event_type,actor_id) VALUES(p_box_id,'BOX_DELETED',p_actor);
END $$;

-- Check a stored sample out of its slot (reason required) / return it. The slot stays reserved either way.
CREATE FUNCTION lab_storage_check_out(p_round_id uuid,p_storage_type text,p_box_id uuid,p_slot integer,p_reason text,p_actor uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE pos public.lab_storage_typed_position; last_event text; new_id uuid;
BEGIN
 IF p_storage_type NOT IN ('BACKUP','BUFFY_COAT') THEN RAISE EXCEPTION 'STORAGE_BOX_TYPE_INVALID'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.app_user WHERE app_user.id=p_actor AND app_user.enabled) THEN RAISE EXCEPTION 'STORAGE_ACTOR_INVALID'; END IF;
 IF p_reason IS NULL OR length(trim(p_reason))<3 THEN RAISE EXCEPTION 'STORAGE_CHECKOUT_REASON_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_box_id::text,75432833));
 SELECT p.* INTO pos FROM public.lab_storage_typed_position p WHERE p.round_id=p_round_id AND p.storage_type=p_storage_type FOR UPDATE;
 IF pos.id IS NULL OR pos.box_id<>p_box_id OR pos.slot<>p_slot THEN RAISE EXCEPTION 'STORAGE_MOVE_STALE'; END IF;
 SELECT c.event INTO last_event FROM public.lab_storage_checkout c WHERE c.position_id=pos.id ORDER BY c.sequence DESC LIMIT 1;
 IF last_event='CHECK_OUT' THEN RAISE EXCEPTION 'STORAGE_ALREADY_CHECKED_OUT'; END IF;
 INSERT INTO public.lab_storage_checkout(position_id,round_id,storage_type,box_id,slot,event,reason,actor_id)
  VALUES(pos.id,p_round_id,p_storage_type,p_box_id,p_slot,'CHECK_OUT',trim(p_reason),p_actor) RETURNING id INTO new_id;
 INSERT INTO public.lab_storage_box_event(box_id,event_type,round_id,storage_type,slot,actor_id) VALUES(p_box_id,'SAMPLE_CHECKED_OUT',p_round_id,p_storage_type,p_slot,p_actor);
 RETURN new_id;
END $$;

CREATE FUNCTION lab_storage_return(p_round_id uuid,p_storage_type text,p_box_id uuid,p_slot integer,p_reason text,p_actor uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE pos public.lab_storage_typed_position; last_event text; new_id uuid;
BEGIN
 IF p_storage_type NOT IN ('BACKUP','BUFFY_COAT') THEN RAISE EXCEPTION 'STORAGE_BOX_TYPE_INVALID'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.app_user WHERE app_user.id=p_actor AND app_user.enabled) THEN RAISE EXCEPTION 'STORAGE_ACTOR_INVALID'; END IF;
 IF p_reason IS NULL OR length(trim(p_reason))<3 THEN RAISE EXCEPTION 'STORAGE_CHECKOUT_REASON_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_box_id::text,75432833));
 SELECT p.* INTO pos FROM public.lab_storage_typed_position p WHERE p.round_id=p_round_id AND p.storage_type=p_storage_type FOR UPDATE;
 IF pos.id IS NULL OR pos.box_id<>p_box_id OR pos.slot<>p_slot THEN RAISE EXCEPTION 'STORAGE_MOVE_STALE'; END IF;
 SELECT c.event INTO last_event FROM public.lab_storage_checkout c WHERE c.position_id=pos.id ORDER BY c.sequence DESC LIMIT 1;
 IF last_event IS DISTINCT FROM 'CHECK_OUT' THEN RAISE EXCEPTION 'STORAGE_NOT_CHECKED_OUT'; END IF;
 INSERT INTO public.lab_storage_checkout(position_id,round_id,storage_type,box_id,slot,event,reason,actor_id)
  VALUES(pos.id,p_round_id,p_storage_type,p_box_id,p_slot,'RETURN',trim(p_reason),p_actor) RETURNING id INTO new_id;
 INSERT INTO public.lab_storage_box_event(box_id,event_type,round_id,storage_type,slot,actor_id) VALUES(p_box_id,'SAMPLE_RETURNED',p_round_id,p_storage_type,p_slot,p_actor);
 RETURN new_id;
END $$;

REVOKE ALL ON FUNCTION lab_storage_create_pair(uuid),lab_storage_delete_box(uuid,uuid,text),lab_storage_check_out(uuid,text,uuid,integer,text,uuid),lab_storage_return(uuid,text,uuid,integer,text,uuid) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN
 REVOKE INSERT,UPDATE,DELETE ON lab_storage_checkout FROM app_rw;
 GRANT SELECT ON lab_storage_checkout TO app_rw;
 GRANT EXECUTE ON FUNCTION lab_storage_create_pair(uuid),lab_storage_delete_box(uuid,uuid,text),lab_storage_check_out(uuid,text,uuid,integer,text,uuid),lab_storage_return(uuid,text,uuid,integer,text,uuid) TO app_rw;
END IF; END $$;
