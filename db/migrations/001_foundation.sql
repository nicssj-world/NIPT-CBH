CREATE FUNCTION immutable_row() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'append-only record'; END $$;
CREATE TABLE nipt_case (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), registration_origin text NOT NULL CHECK(registration_origin IN ('ANC','LAB_DIRECT','HISTORICAL')),
 identity_key text NOT NULL CHECK(length(identity_key)=64), current_round_id uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION case_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='INSERT' AND NEW.registration_origin='HISTORICAL' THEN RAISE EXCEPTION 'P1 historical promotion disabled'; END IF;
 IF TG_OP='UPDATE' AND (NEW.registration_origin<>OLD.registration_origin OR NEW.identity_key<>OLD.identity_key) THEN RAISE EXCEPTION 'immutable origin and identity'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER case_guard BEFORE INSERT OR UPDATE ON nipt_case FOR EACH ROW EXECUTE FUNCTION case_guard();
CREATE TABLE case_ln (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL UNIQUE REFERENCES nipt_case(id), ln text NOT NULL CHECK(ln ~ '^[0-9]+$'),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), source text NOT NULL DEFAULT 'ANC_ENTRY' CHECK(source IN ('ANC_ENTRY','LAB_ENTRY','HISTORICAL_DOCUMENT')), verification text NOT NULL DEFAULT 'AWAITING_PET' CHECK(verification IN ('AWAITING_PET','VERIFIED_BY_PET','RETIRED')),
 UNIQUE(ln,version), UNIQUE(id,case_id)
);
CREATE TABLE redraw_request (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid NOT NULL REFERENCES nipt_case(id),source_round_id uuid NOT NULL,
 reason_code text NOT NULL, state text NOT NULL DEFAULT 'Requested' CHECK(state IN ('Requested','Completed','Cancelled')), UNIQUE(id,case_id)
);
CREATE TABLE specimen_round (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid NOT NULL REFERENCES nipt_case(id),case_ln_id uuid NOT NULL,
 round_number integer NOT NULL CHECK(round_number>0),state text NOT NULL DEFAULT 'Expected' CHECK(state IN ('Expected','ReceivedInHIS','ReceivedInNIPT','RedrawRequested','Completed','Cancelled')),
 redraw_request_id uuid, received_source text CHECK(received_source IN ('HIS_PET_RECEIPT','NIPT_LOCAL_RECEIPT')),received_at timestamptz,received_by uuid,receipt_check jsonb,collection_date date,
 analysis_started boolean NOT NULL DEFAULT false,
 UNIQUE(id,case_id),UNIQUE(id,case_id,case_ln_id),UNIQUE(case_id,round_number),
 FOREIGN KEY(case_ln_id,case_id) REFERENCES case_ln(id,case_id),FOREIGN KEY(redraw_request_id,case_id) REFERENCES redraw_request(id,case_id),
 CHECK((round_number=1 AND redraw_request_id IS NULL) OR (round_number>=2 AND redraw_request_id IS NOT NULL)),
 CHECK(received_source IS NULL OR (round_number=1 AND received_source='HIS_PET_RECEIPT') OR (round_number>=2 AND received_source='NIPT_LOCAL_RECEIPT')),
 CHECK((received_source IS NULL AND received_at IS NULL) OR (received_source IS NOT NULL AND received_at IS NOT NULL)),
 CHECK(state<>'ReceivedInHIS' OR (round_number=1 AND received_source IS NOT NULL AND received_source='HIS_PET_RECEIPT' AND received_at IS NOT NULL)),
 CHECK(state<>'ReceivedInNIPT' OR (round_number>=2 AND received_source IS NOT NULL AND received_source='NIPT_LOCAL_RECEIPT' AND received_at IS NOT NULL)),
 CHECK(received_source IS DISTINCT FROM 'NIPT_LOCAL_RECEIPT' OR (received_by IS NOT NULL AND receipt_check IS NOT NULL AND receipt_check @> '{"identity":true,"label":true}'::jsonb))
);
CREATE UNIQUE INDEX one_current_round ON specimen_round(case_id) WHERE state NOT IN ('Cancelled','RedrawRequested','Completed');
ALTER TABLE nipt_case ADD CONSTRAINT current_round_same_case FOREIGN KEY(current_round_id,id) REFERENCES specimen_round(id,case_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE redraw_request ADD FOREIGN KEY(source_round_id,case_id) REFERENCES specimen_round(id,case_id);
CREATE FUNCTION round_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM nipt_case WHERE id=NEW.case_id AND registration_origin='HISTORICAL') THEN RAISE EXCEPTION 'historical downstream prohibited'; END IF;
 IF TG_OP='UPDATE' AND (NEW.case_id<>OLD.case_id OR NEW.case_ln_id<>OLD.case_ln_id OR NEW.round_number<>OLD.round_number OR NEW.redraw_request_id IS DISTINCT FROM OLD.redraw_request_id OR (OLD.received_at IS NOT NULL AND (NEW.received_at IS DISTINCT FROM OLD.received_at OR NEW.received_source IS DISTINCT FROM OLD.received_source OR NEW.received_by IS DISTINCT FROM OLD.received_by OR NEW.receipt_check IS DISTINCT FROM OLD.receipt_check OR NEW.collection_date IS DISTINCT FROM OLD.collection_date)) OR (OLD.analysis_started AND NOT NEW.analysis_started)) THEN RAISE EXCEPTION 'immutable round lineage or receipt'; END IF;
 IF TG_OP='INSERT' AND NEW.round_number>=2 AND NOT EXISTS(SELECT 1 FROM redraw_request d JOIN specimen_round s ON s.id=d.source_round_id WHERE d.id=NEW.redraw_request_id AND d.case_id=NEW.case_id AND d.state='Requested' AND s.round_number=NEW.round_number-1 AND s.case_ln_id=NEW.case_ln_id) THEN RAISE EXCEPTION 'invalid redraw lineage'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER round_guard BEFORE INSERT OR UPDATE ON specimen_round FOR EACH ROW EXECUTE FUNCTION round_guard();
CREATE TABLE repeat_work_order(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid NOT NULL,round_id uuid NOT NULL,reason_code text NOT NULL,state text NOT NULL CHECK(state IN ('RepeatRequested','RepeatPendingBatch','RepeatInProgress','Completed','Cancelled')),FOREIGN KEY(round_id,case_id) REFERENCES specimen_round(id,case_id),UNIQUE(id,round_id,case_id));
CREATE TABLE analytical_attempt(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid NOT NULL,round_id uuid NOT NULL,attempt_number integer NOT NULL CHECK(attempt_number>0),repeat_order_id uuid,state text NOT NULL DEFAULT 'Ready' CHECK(state IN ('Ready','Assigned','Cancelled')),FOREIGN KEY(round_id,case_id) REFERENCES specimen_round(id,case_id),FOREIGN KEY(repeat_order_id,round_id,case_id) REFERENCES repeat_work_order(id,round_id,case_id),UNIQUE(round_id,attempt_number),CHECK((attempt_number=1 AND repeat_order_id IS NULL) OR (attempt_number>=2 AND repeat_order_id IS NOT NULL)));
CREATE TABLE his_inbound_file(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),state text NOT NULL CHECK(state IN ('Ready','Applied(S1)','Conflict')),synthetic boolean NOT NULL DEFAULT true CHECK(synthetic));
CREATE TABLE his_order(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_ln_id uuid NOT NULL UNIQUE REFERENCES case_ln(id),inbound_file_id uuid NOT NULL UNIQUE REFERENCES his_inbound_file(id),his_received_at timestamptz NOT NULL);
CREATE FUNCTION pet_order_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM his_inbound_file WHERE id=NEW.inbound_file_id AND state='Applied(S1)') THEN RAISE EXCEPTION 'order requires applied PET'; END IF;
 IF EXISTS(SELECT 1 FROM case_ln l JOIN nipt_case c ON c.id=l.case_id WHERE l.id=NEW.case_ln_id AND c.registration_origin='HISTORICAL') THEN RAISE EXCEPTION 'historical order prohibited'; END IF;
 UPDATE case_ln SET verification='VERIFIED_BY_PET' WHERE id=NEW.case_ln_id;
 RETURN NEW; END $$;
CREATE TRIGGER pet_order_guard BEFORE INSERT ON his_order FOR EACH ROW EXECUTE FUNCTION pet_order_guard();
CREATE FUNCTION ln_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.case_id<>OLD.case_id OR NEW.ln<>OLD.ln OR NEW.version<>OLD.version OR NEW.source<>OLD.source THEN RAISE EXCEPTION 'immutable LN lineage'; END IF;
 IF NEW.verification='VERIFIED_BY_PET' AND OLD.verification<>'VERIFIED_BY_PET' AND pg_trigger_depth()<2 THEN RAISE EXCEPTION 'verification requires PET order'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER ln_guard BEFORE UPDATE ON case_ln FOR EACH ROW EXECUTE FUNCTION ln_guard();
CREATE TABLE registration_attempt(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid REFERENCES nipt_case(id),origin text NOT NULL,outcome text NOT NULL CHECK(outcome IN ('CREATED','OPENED','CONFLICT','REJECTED')),actor_id uuid,idempotency_key text NOT NULL UNIQUE,request_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE clinical_snapshot(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid NOT NULL,round_id uuid NOT NULL,rule_version text NOT NULL,input_snapshot jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(round_id,case_id) REFERENCES specimen_round(id,case_id));
CREATE TABLE case_event(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid NOT NULL REFERENCES nipt_case(id),event_type text NOT NULL,details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE audit_chain(sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,actor_id uuid,action text NOT NULL,resource_type text NOT NULL,resource_id uuid,details jsonb NOT NULL,previous_hash text NOT NULL,hash text NOT NULL UNIQUE,payload text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE file_asset(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sha256 text NOT NULL UNIQUE CHECK(sha256 ~ '^[a-f0-9]{64}$'),byte_size bigint NOT NULL CHECK(byte_size>=0),media_type text NOT NULL,storage_key text NOT NULL UNIQUE,synthetic boolean NOT NULL DEFAULT true CHECK(synthetic),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE job_outbox(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text NOT NULL,payload jsonb NOT NULL,idempotency_key text NOT NULL UNIQUE,cancel_epoch integer NOT NULL DEFAULT 0 CHECK(cancel_epoch>=0),state text NOT NULL DEFAULT 'Pending' CHECK(state IN ('Pending','Dispatched','Cancelled')),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE worker_heartbeat(worker_id text PRIMARY KEY,observed_at timestamptz NOT NULL,details jsonb NOT NULL DEFAULT '{}');
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_chain FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER clinical_immutable BEFORE UPDATE OR DELETE ON clinical_snapshot FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER event_immutable BEFORE UPDATE OR DELETE ON case_event FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER registration_immutable BEFORE UPDATE OR DELETE ON registration_attempt FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER file_immutable BEFORE UPDATE OR DELETE ON file_asset FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER order_immutable BEFORE UPDATE OR DELETE ON his_order FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE FUNCTION ln_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.verification<>'AWAITING_PET' THEN RAISE EXCEPTION 'LN begins awaiting PET'; END IF; RETURN NEW; END $$;
CREATE TRIGGER ln_insert_guard BEFORE INSERT ON case_ln FOR EACH ROW EXECUTE FUNCTION ln_insert_guard();
CREATE FUNCTION s1_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.received_source='HIS_PET_RECEIPT' AND NOT EXISTS(SELECT 1 FROM his_order WHERE case_ln_id=NEW.case_ln_id AND his_received_at=NEW.received_at) THEN RAISE EXCEPTION 'S1 receipt requires applied HIS order and immutable HIS time'; END IF; RETURN NEW; END $$;
CREATE CONSTRAINT TRIGGER s1_receipt_guard AFTER INSERT OR UPDATE ON specimen_round DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION s1_receipt_guard();
CREATE FUNCTION work_lineage_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.case_id<>OLD.case_id OR NEW.round_id<>OLD.round_id THEN RAISE EXCEPTION 'immutable work lineage'; END IF;
 IF TG_TABLE_NAME='analytical_attempt' AND (NEW.repeat_order_id IS DISTINCT FROM OLD.repeat_order_id OR NEW.attempt_number<>OLD.attempt_number) THEN RAISE EXCEPTION 'immutable attempt lineage'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER repeat_lineage_guard BEFORE UPDATE ON repeat_work_order FOR EACH ROW EXECUTE FUNCTION work_lineage_guard();
CREATE TRIGGER attempt_lineage_guard BEFORE UPDATE ON analytical_attempt FOR EACH ROW EXECUTE FUNCTION work_lineage_guard();
CREATE FUNCTION redraw_lineage_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.case_id<>OLD.case_id OR NEW.source_round_id<>OLD.source_round_id THEN RAISE EXCEPTION 'immutable redraw lineage'; END IF; RETURN NEW; END $$;
CREATE TRIGGER redraw_lineage_guard BEFORE UPDATE ON redraw_request FOR EACH ROW EXECUTE FUNCTION redraw_lineage_guard();

