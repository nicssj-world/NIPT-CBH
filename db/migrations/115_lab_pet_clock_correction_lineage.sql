-- LAB-11: append-only correction overlay. Never rewrite raw PET, issued LN Halos, old receipt rows or snapshots.
CREATE TABLE lab_pet_clock_correction(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),inbound_file_id uuid NOT NULL UNIQUE REFERENCES his_inbound_file,
 round_id uuid UNIQUE REFERENCES specimen_round,
 raw_sha256 text NOT NULL CHECK(raw_sha256 ~ '^[a-f0-9]{64}$'),
 previous_parsed jsonb NOT NULL,corrected_parsed jsonb NOT NULL,
 reason text NOT NULL CHECK(length(trim(reason))>=8),actor_id uuid NOT NULL REFERENCES app_user,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(corrected_parsed->>'parserVersion'='pet-strict-cp874-owner-clock-v2')
);
CREATE TRIGGER lab_pet_clock_correction_immutable BEFORE UPDATE OR DELETE ON lab_pet_clock_correction FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE FUNCTION lab_pet_clock_correction_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE f his_inbound_file; BEGIN
 SELECT * INTO f FROM his_inbound_file WHERE id=NEW.inbound_file_id FOR UPDATE;
 IF f.sha256<>NEW.raw_sha256 OR f.parsed IS DISTINCT FROM NEW.previous_parsed OR f.parser_version<>'pet-strict-cp874-v1'
 OR NEW.corrected_parsed->>'hash'<>f.sha256 OR NEW.corrected_parsed->>'filename'<>f.filename
 OR (NEW.previous_parsed-ARRAY['receivedAt','orderAt','parserVersion']) IS DISTINCT FROM (NEW.corrected_parsed-ARRAY['receivedAt','orderAt','parserVersion'])
 OR NEW.corrected_parsed->>'orderAt' IS DISTINCT FROM NEW.previous_parsed->>'receivedAt'
 OR (NEW.round_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM his_order WHERE inbound_file_id=f.id AND round_id=NEW.round_id))
 THEN RAISE EXCEPTION 'PET_CLOCK_CORRECTION_SOURCE_MISMATCH'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lab_pet_clock_correction_guard BEFORE INSERT ON lab_pet_clock_correction FOR EACH ROW EXECUTE FUNCTION lab_pet_clock_correction_guard();
-- Explicit columns let PostgreSQL retain indexed predicate pushdown on cases/rounds.
DO $$ DECLARE columns text; BEGIN
 SELECT string_agg(CASE a.attname WHEN 'parsed' THEN 'COALESCE(c.corrected_parsed,f.parsed) AS parsed' WHEN 'parser_version' THEN 'COALESCE(c.corrected_parsed->>''parserVersion'',f.parser_version) AS parser_version' ELSE format('f.%I',a.attname) END,',' ORDER BY a.attnum) INTO columns FROM pg_attribute a WHERE a.attrelid='his_inbound_file'::regclass AND a.attnum>0 AND NOT a.attisdropped;
 EXECUTE 'CREATE VIEW his_inbound_file_current WITH(security_invoker=true) AS SELECT '||columns||' FROM his_inbound_file f LEFT JOIN lab_pet_clock_correction c ON c.inbound_file_id=f.id';
 SELECT string_agg(CASE a.attname WHEN 'his_received_at' THEN 'COALESCE((c.corrected_parsed->>''receivedAt'')::timestamptz,o.his_received_at) AS his_received_at' ELSE format('o.%I',a.attname) END,',' ORDER BY a.attnum) INTO columns FROM pg_attribute a WHERE a.attrelid='his_order'::regclass AND a.attnum>0 AND NOT a.attisdropped;
 EXECUTE 'CREATE VIEW his_order_current WITH(security_invoker=true) AS SELECT '||columns||' FROM his_order o LEFT JOIN lab_pet_clock_correction c ON c.inbound_file_id=o.inbound_file_id';
 SELECT string_agg(CASE a.attname WHEN 'received_at' THEN 'COALESCE((c.corrected_parsed->>''receivedAt'')::timestamptz,r.received_at) AS received_at' ELSE format('r.%I',a.attname) END,',' ORDER BY a.attnum) INTO columns FROM pg_attribute a WHERE a.attrelid='specimen_round'::regclass AND a.attnum>0 AND NOT a.attisdropped;
 EXECUTE 'CREATE VIEW specimen_round_current WITH(security_invoker=true) AS SELECT '||columns||' FROM specimen_round r LEFT JOIN lab_pet_clock_correction c ON c.round_id=r.id';
END $$;
REVOKE ALL ON lab_pet_clock_correction FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['app_rw','worker_rw','report_ro'] LOOP
 IF EXISTS(SELECT FROM pg_roles WHERE rolname=r) THEN EXECUTE format('GRANT SELECT ON lab_pet_clock_correction,his_inbound_file_current,his_order_current,specimen_round_current TO %I',r); END IF;
END LOOP; END $$;
