-- Owner 2026-11-10: a deleted box gives its number back. A new box (or pair) takes the LOWEST number that no active box of its type uses,
-- so deleting Box001 and opening a box again gives Box001 again. Deleted boxes keep their rows and history (identified by their uuid);
-- only the numbering and its uniqueness now look at active boxes alone. Forward-only; 214 is not edited.

-- Uniqueness of the shown number / label applies to active boxes only.
ALTER TABLE lab_storage_box DROP CONSTRAINT lab_storage_box_box_id_type_key;
CREATE UNIQUE INDEX lab_storage_box_box_id_type_active ON lab_storage_box(box_id,box_type) WHERE deleted_at IS NULL;
DROP INDEX lab_storage_box_type_number;
CREATE UNIQUE INDEX lab_storage_box_type_number_active ON lab_storage_box(box_type,type_number) WHERE type_number IS NOT NULL AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION lab_storage_create_box(p_box_type text,p_actor uuid)
RETURNS TABLE(id uuid,box_id text,box_type text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE box_no bigint; new_id uuid; n integer; new_label text;
BEGIN
 IF p_box_type NOT IN ('BACKUP','BUFFY_COAT') THEN RAISE EXCEPTION 'STORAGE_BOX_TYPE_INVALID'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.app_user WHERE app_user.id=p_actor AND app_user.enabled) THEN RAISE EXCEPTION 'STORAGE_ACTOR_INVALID'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sample-storage-box-number',75432834));
 SELECT min(g.n) INTO n FROM generate_series(1,(SELECT COALESCE(max(b.type_number),0)+1 FROM public.lab_storage_box b WHERE b.box_type=p_box_type AND b.deleted_at IS NULL)) g(n)
  WHERE NOT EXISTS(SELECT 1 FROM public.lab_storage_box b WHERE b.box_type=p_box_type AND b.deleted_at IS NULL AND b.type_number=g.n);
 box_no:=nextval('public.lab_storage_box_box_number_seq'::regclass);
 new_id:=gen_random_uuid();
 new_label:='Box'||lpad(n::text,3,'0');
 INSERT INTO public.lab_storage_box(id,box_number,box_id,created_by,box_type,type_number)
  OVERRIDING SYSTEM VALUE VALUES(new_id,box_no,new_label,p_actor,p_box_type,n);
 INSERT INTO public.lab_storage_box_event(box_id,event_type,actor_id) VALUES(new_id,'BOX_CREATED',p_actor);
 RETURN QUERY SELECT new_id,new_label,p_box_type;
END $$;

-- The pair takes the lowest number that is free in BOTH types, so the two boxes always carry the same number.
CREATE OR REPLACE FUNCTION lab_storage_create_pair(p_actor uuid)
RETURNS TABLE(id uuid,box_id text,box_type text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE n integer; new_label text; t text; new_id uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.app_user WHERE app_user.id=p_actor AND app_user.enabled) THEN RAISE EXCEPTION 'STORAGE_ACTOR_INVALID'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sample-storage-box-number',75432834));
 SELECT min(g.n) INTO n FROM generate_series(1,(SELECT COALESCE(max(b.type_number),0)+1 FROM public.lab_storage_box b WHERE b.box_type IN ('BACKUP','BUFFY_COAT') AND b.deleted_at IS NULL)) g(n)
  WHERE NOT EXISTS(SELECT 1 FROM public.lab_storage_box b WHERE b.box_type IN ('BACKUP','BUFFY_COAT') AND b.deleted_at IS NULL AND b.type_number=g.n);
 new_label:='Box'||lpad(n::text,3,'0');
 FOREACH t IN ARRAY ARRAY['BACKUP','BUFFY_COAT'] LOOP
  new_id:=gen_random_uuid();
  INSERT INTO public.lab_storage_box(id,box_number,box_id,created_by,box_type,type_number)
   OVERRIDING SYSTEM VALUE VALUES(new_id,nextval('public.lab_storage_box_box_number_seq'::regclass),new_label,p_actor,t,n);
  INSERT INTO public.lab_storage_box_event(box_id,event_type,actor_id) VALUES(new_id,'BOX_CREATED',p_actor);
  id:=new_id;box_id:=new_label;box_type:=t;RETURN NEXT;
 END LOOP;
END $$;
