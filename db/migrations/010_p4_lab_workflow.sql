-- P4 synthetic Lab workflow (Plan v6.2.1 §4.2–4.3, §5.6, §5.9.1, §12.2–§12.11, §12.15, §12.20–§12.22, §12.24, §12.26;
-- Owner Lock 2026-10-12 tube labels; Genomic-CBH number-generation parity). Additive only; synthetic data only.

-- 1. LN Halos (D-56, AT-LNH-01..03, AT-IDPAR-01/02, AT-LABEL-05). Format and sequence rules are Genomic-CBH register_nipt_sample;
--    the issuing event is the Owner-approved actual receipt (S1 = HIS PET receipt, S2+ = NIPT local receipt), never registration.
CREATE FUNCTION p4_format_ln_halos(d date,n integer) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT to_char(d,'YY')||'B'||to_char(d,'YYMMDD')||lpad(n::text,3,'0') $$;
CREATE FUNCTION p4_bangkok_date(t timestamptz) RETURNS date LANGUAGE sql STABLE STRICT AS $$ SELECT (t AT TIME ZONE 'Asia/Bangkok')::date $$;
CREATE TABLE ln_halos_daily_sequence(sequence_date date PRIMARY KEY,last_value integer NOT NULL CHECK(last_value BETWEEN 0 AND 999));
CREATE TABLE specimen_lab_number(
 round_id uuid PRIMARY KEY,case_id uuid NOT NULL,ln_halos text NOT NULL UNIQUE CHECK(ln_halos ~ '^[0-9]{2}B[0-9]{9}$'),
 sequence_date date NOT NULL,sequence_value integer NOT NULL CHECK(sequence_value BETWEEN 1 AND 999),
 issued_on text NOT NULL CHECK(issued_on IN ('HIS_PET_RECEIPT','NIPT_LOCAL_RECEIPT')),issue_path text NOT NULL CHECK(issue_path IN ('RECEIPT_TRIGGER','RECEIPT_RECOVERY')),
 issued_at timestamptz NOT NULL DEFAULT now(),UNIQUE(sequence_date,sequence_value),
 FOREIGN KEY(round_id,case_id) REFERENCES specimen_round(id,case_id),CHECK(ln_halos=p4_format_ln_halos(sequence_date,sequence_value))
);
CREATE TRIGGER specimen_lab_number_immutable BEFORE UPDATE OR DELETE ON specimen_lab_number FOR EACH ROW EXECUTE FUNCTION immutable_row();

-- 2. Analytical attempt lifecycle (§5.6) and lineage.
ALTER TABLE analytical_attempt DROP CONSTRAINT analytical_attempt_state_check;
ALTER TABLE analytical_attempt ADD CONSTRAINT analytical_attempt_state_check CHECK(state IN ('Ready','Assigned','InProgress','QcFailed','AnalysisComplete','FinalQcAccepted','Final','Superseded','Stopped','BatchCancelled','Cancelled'));
ALTER TABLE analytical_attempt
 ADD COLUMN printed_sample_id text UNIQUE CHECK(printed_sample_id ~ '^[0-9]{2}B[0-9]{9}D?(-[12]|R)$'),
 ADD COLUMN qc_failed_stage text CHECK(qc_failed_stage IN ('QC1')),
 ADD COLUMN resume_decision_required boolean NOT NULL DEFAULT false,
 ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
 ADD CONSTRAINT attempt_qc_failed_stage CHECK((state='QcFailed')<=(qc_failed_stage IS NOT NULL));
CREATE INDEX analytical_attempt_state ON analytical_attempt(state);
-- Allowed transitions (Plan §5.6 Analytical Attempt state diagram). Anything else is a programming error.
CREATE FUNCTION p4_attempt_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.printed_sample_id IS NOT NULL AND NEW.printed_sample_id IS DISTINCT FROM OLD.printed_sample_id THEN RAISE EXCEPTION 'PRINTED_SAMPLE_ID_IMMUTABLE'; END IF;
 IF NEW.state<>OLD.state AND NOT ((OLD.state,NEW.state) IN (('Ready','Assigned'),('Assigned','Ready'),('Assigned','InProgress'),('Ready','Stopped'),('Assigned','Stopped'),('InProgress','Stopped'),
  ('Assigned','BatchCancelled'),('InProgress','BatchCancelled'),('InProgress','QcFailed'),('InProgress','AnalysisComplete'),('AnalysisComplete','FinalQcAccepted'),('AnalysisComplete','QcFailed'),
  ('FinalQcAccepted','Final'),('FinalQcAccepted','Superseded'),('QcFailed','Superseded'),('Stopped','Superseded'),('BatchCancelled','Superseded'),('Ready','Cancelled')))
 THEN RAISE EXCEPTION 'ATTEMPT_TRANSITION_PROHIBITED'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER p4_attempt_transition_guard BEFORE UPDATE ON analytical_attempt FOR EACH ROW EXECUTE FUNCTION p4_attempt_transition_guard();

ALTER TABLE repeat_work_order DROP CONSTRAINT repeat_work_order_state_check;
ALTER TABLE repeat_work_order ADD CONSTRAINT repeat_work_order_state_check CHECK(state IN ('RepeatRequested','RepeatPendingBatch','RepeatInProgress','Completed','RepeatFailed','Cancelled'));
ALTER TABLE repeat_work_order
 ADD COLUMN parent_attempt_id uuid REFERENCES analytical_attempt,
 ADD COLUMN level text CHECK(level IN ('RE_LIBRARY','RE_EXTRACTION')),
 ADD COLUMN note text,ADD COLUMN requested_by uuid REFERENCES app_user,ADD COLUMN requested_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN closed_by uuid REFERENCES app_user,ADD COLUMN closed_at timestamptz,ADD COLUMN close_reason text;
-- BG-09F: never two live repeat orders for one specimen round.
CREATE UNIQUE INDEX one_active_repeat_per_round ON repeat_work_order(round_id) WHERE state IN ('RepeatRequested','RepeatPendingBatch','RepeatInProgress');

ALTER TABLE redraw_request
 ADD COLUMN note text,ADD COLUMN requested_by uuid REFERENCES app_user,ADD COLUMN requested_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN prior_round_state text,ADD COLUMN closed_by uuid REFERENCES app_user,ADD COLUMN closed_at timestamptz,ADD COLUMN close_reason text;

-- Append-only work events: urgency (with reason), hold/release, queue-order overrides, lineage and state changes.
CREATE TABLE attempt_event(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sequence bigint GENERATED ALWAYS AS IDENTITY,attempt_id uuid NOT NULL REFERENCES analytical_attempt,case_id uuid NOT NULL REFERENCES nipt_case,
 event_type text NOT NULL CHECK(event_type IN ('URGENT_SET','URGENT_CLEARED','HOLD_SET','HOLD_RELEASED','QUEUE_OVERRIDE','STATE_CHANGED','REPEAT_ORDERED','PRINTED_ID_ASSIGNED')),
 stage text CHECK(stage IN ('QC1')),from_state text,to_state text,reason text,actor_id uuid REFERENCES app_user,details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(event_type NOT IN ('URGENT_SET','HOLD_SET','HOLD_RELEASED','QUEUE_OVERRIDE','URGENT_CLEARED') OR (actor_id IS NOT NULL AND length(trim(reason))>=8))
);
CREATE INDEX attempt_event_attempt ON attempt_event(attempt_id,sequence);
CREATE TRIGGER attempt_event_immutable BEFORE UPDATE OR DELETE ON attempt_event FOR EACH ROW EXECUTE FUNCTION immutable_row();

-- Issuer: one function for both the receipt trigger and audited recovery of rounds received before P4 existed.
CREATE FUNCTION p4_ensure_ln_halos(p_round uuid,p_path text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r specimen_round; d date; n integer; code text; BEGIN
 IF p_path NOT IN ('RECEIPT_TRIGGER','RECEIPT_RECOVERY') THEN RAISE EXCEPTION 'LN_HALOS_ISSUE_PATH_INVALID'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_round::text,75432810));
 SELECT * INTO r FROM specimen_round WHERE id=p_round;
 IF r.id IS NULL OR r.received_at IS NULL OR r.received_source IS NULL THEN RAISE EXCEPTION 'LN_HALOS_REQUIRES_RECEIPT'; END IF;
 SELECT ln_halos INTO code FROM specimen_lab_number WHERE round_id=p_round;
 IF code IS NOT NULL THEN RETURN code; END IF;
 -- Lock order: the audit-chain serializer (75432801, packages/db/audit.ts) is always taken before the daily sequence row, so a
 -- receipt inside a transaction that later appends audit can never cross another transaction holding the audit lock.
 PERFORM pg_advisory_xact_lock(75432801);
 d:=p4_bangkok_date(now());
 INSERT INTO ln_halos_daily_sequence(sequence_date,last_value) VALUES(d,0) ON CONFLICT(sequence_date) DO NOTHING;
 SELECT last_value INTO n FROM ln_halos_daily_sequence WHERE sequence_date=d FOR UPDATE;
 IF n>=999 THEN RAISE EXCEPTION 'LN_HALOS_DAILY_SEQUENCE_EXHAUSTED'; END IF;
 n:=n+1;UPDATE ln_halos_daily_sequence SET last_value=n WHERE sequence_date=d;
 code:=p4_format_ln_halos(d,n);
 INSERT INTO specimen_lab_number(round_id,case_id,ln_halos,sequence_date,sequence_value,issued_on,issue_path) VALUES(r.id,r.case_id,code,d,n,r.received_source,p_path);
 INSERT INTO analytical_attempt(case_id,round_id,attempt_number,state) VALUES(r.case_id,r.id,1,'Ready') ON CONFLICT(round_id,attempt_number) DO NOTHING;
 RETURN code;
END $$;
CREATE FUNCTION p4_receipt_issue() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN
 IF NEW.received_at IS NOT NULL AND (TG_OP='INSERT' OR OLD.received_at IS NULL) THEN PERFORM p4_ensure_ln_halos(NEW.id,'RECEIPT_TRIGGER'); END IF;
 RETURN NULL; END $$;
CREATE TRIGGER p4_receipt_issue AFTER INSERT OR UPDATE OF received_at ON specimen_round FOR EACH ROW EXECUTE FUNCTION p4_receipt_issue();
REVOKE ALL ON FUNCTION p4_ensure_ln_halos(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION p4_receipt_issue() FROM PUBLIC;

-- 3. Batch / Task List template (§12.4, §12.9; legacy create_nipt_batch): Run label RunNNN/YYYY per Bangkok year, 48 slots, PC1/NC25/Blank40.
CREATE TABLE lab_batch_sequence(run_year integer PRIMARY KEY,last_value integer NOT NULL CHECK(last_value>=0));
CREATE TABLE lab_batch(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_year integer NOT NULL,run_number integer NOT NULL CHECK(run_number>0),run_label text NOT NULL UNIQUE,
 state text NOT NULL DEFAULT 'Draft' CHECK(state IN ('Draft','InPreparation','ExtractionLibrary','QC1Complete','Cancelled')),version integer NOT NULL DEFAULT 0 CHECK(version>=0),
 template_version text NOT NULL,formula_version text NOT NULL,created_by uuid NOT NULL REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT now(),
 cancelled_by uuid REFERENCES app_user,cancelled_at timestamptz,cancel_reason text,synthetic boolean NOT NULL DEFAULT true CHECK(synthetic),
 UNIQUE(run_year,run_number),CHECK(run_label='Run'||lpad(run_number::text,3,'0')||'/'||run_year::text),
 CHECK((state='Cancelled')=(cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND length(trim(cancel_reason))>=8))
);
-- Genomic-CBH allows a single assembling batch system-wide; the concurrent-draft policy remains OD-34.
CREATE UNIQUE INDEX one_draft_batch ON lab_batch((true)) WHERE state='Draft';
CREATE TABLE lab_task_sheet(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid NOT NULL REFERENCES lab_batch,sheet_number integer NOT NULL CHECK(sheet_number BETWEEN 1 AND 3),
 state text NOT NULL DEFAULT 'Draft' CHECK(state IN ('Draft','PlanChecked','PlacementFinalized','PreWorkIssued','Amended','InExecution','ExecutionRecorded','ExecutionVerified','CompletedIssued','Cancelled')),
 planned_work_date date,planned_operator text,planned_extraction_lot text,planned_extraction_expiry date,planned_library_lot text,planned_library_expiry date,
 plan_checked_by uuid REFERENCES app_user,plan_checked_at timestamptz,plan_checked_version integer,
 placement_version integer NOT NULL DEFAULT 0 CHECK(placement_version>=0),
 finalized_by uuid REFERENCES app_user,finalized_at timestamptz,placement_revision integer NOT NULL DEFAULT 0 CHECK(placement_revision>=0),
 execution_mode text CHECK(execution_mode IN ('ONLINE_LIVE')),execution_started_at timestamptz,execution_started_by uuid REFERENCES app_user,
 execution_ended_at timestamptz,execution_ended_by uuid REFERENCES app_user,verified_by uuid REFERENCES app_user,verified_at timestamptz,
 UNIQUE(batch_id,sheet_number),UNIQUE(id,batch_id),
 CHECK(state NOT IN ('InExecution','ExecutionRecorded','ExecutionVerified','CompletedIssued') OR (execution_started_at IS NOT NULL AND execution_mode IS NOT NULL)),
 CHECK(state NOT IN ('ExecutionRecorded','ExecutionVerified','CompletedIssued') OR execution_ended_at IS NOT NULL),
 CHECK(state NOT IN ('ExecutionVerified','CompletedIssued') OR verified_at IS NOT NULL),
 CHECK(execution_ended_at IS NULL OR execution_ended_at>=execution_started_at)
);
CREATE FUNCTION p4_sheet_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.batch_id<>OLD.batch_id OR NEW.sheet_number<>OLD.sheet_number OR NEW.placement_revision<OLD.placement_revision THEN RAISE EXCEPTION 'IMMUTABLE_SHEET_IDENTITY'; END IF;
 -- The execution anchor is the server time of the online start; it is never rewritten (Plan §12.9, §12.25).
 IF OLD.execution_started_at IS NOT NULL AND (NEW.execution_started_at IS DISTINCT FROM OLD.execution_started_at OR NEW.execution_started_by IS DISTINCT FROM OLD.execution_started_by) THEN RAISE EXCEPTION 'EXECUTION_ANCHOR_IMMUTABLE'; END IF;
 IF NEW.state<>OLD.state AND NOT ((OLD.state,NEW.state) IN (('Draft','PlanChecked'),('PlanChecked','Draft'),('Amended','PlanChecked'),('PlanChecked','PlacementFinalized'),('PlacementFinalized','PreWorkIssued'),
  ('PlacementFinalized','Amended'),('PreWorkIssued','Amended'),('PreWorkIssued','InExecution'),('InExecution','ExecutionRecorded'),('ExecutionRecorded','ExecutionVerified'),('ExecutionVerified','CompletedIssued'),
  ('Draft','Cancelled'),('PlanChecked','Cancelled'),('Amended','Cancelled'),('PlacementFinalized','Cancelled'),('PreWorkIssued','Cancelled')))
 THEN RAISE EXCEPTION 'SHEET_TRANSITION_PROHIBITED'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER p4_sheet_guard BEFORE UPDATE ON lab_task_sheet FOR EACH ROW EXECUTE FUNCTION p4_sheet_guard();
CREATE TABLE lab_batch_slot(
 batch_id uuid NOT NULL REFERENCES lab_batch,slot_number integer NOT NULL CHECK(slot_number BETWEEN 1 AND 48),sheet_number integer NOT NULL,
 plate_position text NOT NULL,barcode_index integer NOT NULL,control_type text CHECK(control_type IN ('positive','negative','blank')),PRIMARY KEY(batch_id,slot_number),
 CHECK(sheet_number=CASE WHEN slot_number<=16 THEN 1 WHEN slot_number<=32 THEN 2 ELSE 3 END),
 CHECK(plate_position=substr('ABCDEFGH',((slot_number-1)%8)+1,1)||(((slot_number-1)/8)+1)::text),CHECK(barcode_index=slot_number),
 CHECK(control_type IS NOT DISTINCT FROM (CASE slot_number WHEN 1 THEN 'positive' WHEN 25 THEN 'negative' WHEN 40 THEN 'blank' END))
);
CREATE TRIGGER lab_batch_slot_immutable BEFORE UPDATE OR DELETE ON lab_batch_slot FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TABLE lab_slot_assignment(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid NOT NULL,slot_number integer NOT NULL,attempt_id uuid NOT NULL REFERENCES analytical_attempt,
 assigned_by uuid NOT NULL REFERENCES app_user,assigned_at timestamptz NOT NULL DEFAULT now(),removed_by uuid REFERENCES app_user,removed_at timestamptz,removed_reason text,
 FOREIGN KEY(batch_id,slot_number) REFERENCES lab_batch_slot,CHECK((removed_at IS NULL)=(removed_by IS NULL) AND (removed_at IS NULL)=(removed_reason IS NULL))
);
-- AT-TASK-04 / §6.3 ข้อ 23: one live slot per attempt and one live attempt per slot, enforced by the database.
CREATE UNIQUE INDEX one_active_slot_per_attempt ON lab_slot_assignment(attempt_id) WHERE removed_at IS NULL;
CREATE UNIQUE INDEX one_attempt_per_active_slot ON lab_slot_assignment(batch_id,slot_number) WHERE removed_at IS NULL;
CREATE FUNCTION p4_assignment_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE s text; BEGIN
 IF TG_OP='UPDATE' AND (NEW.batch_id<>OLD.batch_id OR NEW.slot_number<>OLD.slot_number OR NEW.attempt_id<>OLD.attempt_id OR NEW.assigned_by<>OLD.assigned_by OR NEW.assigned_at<>OLD.assigned_at OR OLD.removed_at IS NOT NULL) THEN RAISE EXCEPTION 'ASSIGNMENT_HISTORY_IMMUTABLE'; END IF;
 IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM lab_batch_slot WHERE batch_id=NEW.batch_id AND slot_number=NEW.slot_number AND control_type IS NOT NULL) THEN RAISE EXCEPTION 'CONTROL_SLOT_PROTECTED'; END IF;
 SELECT t.state INTO s FROM lab_task_sheet t JOIN lab_batch_slot b ON b.batch_id=t.batch_id AND b.sheet_number=t.sheet_number WHERE b.batch_id=NEW.batch_id AND b.slot_number=NEW.slot_number;
 -- Placement changes only while the plan is editable; batch cancellation is the only later release of a live slot.
 IF s NOT IN ('Draft','PlanChecked','Amended') AND NOT (TG_OP='UPDATE' AND NEW.removed_reason='BATCH_CANCELLED') THEN RAISE EXCEPTION 'PLACEMENT_LOCKED'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER p4_assignment_guard BEFORE INSERT OR UPDATE ON lab_slot_assignment FOR EACH ROW EXECUTE FUNCTION p4_assignment_guard();
CREATE TRIGGER lab_slot_assignment_delete_denied BEFORE DELETE ON lab_slot_assignment FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TABLE lab_batch_event(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sequence bigint GENERATED ALWAYS AS IDENTITY,batch_id uuid NOT NULL REFERENCES lab_batch,sheet_number integer,
 event_type text NOT NULL,reason text,actor_id uuid NOT NULL REFERENCES app_user,details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER lab_batch_event_immutable BEFORE UPDATE OR DELETE ON lab_batch_event FOR EACH ROW EXECUTE FUNCTION immutable_row();

-- 4. Immutable Placement snapshot per Sheet revision (§12.15, §6.3 ข้อ 24). No execution data inside.
CREATE TABLE lab_placement_snapshot(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid NOT NULL,sheet_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),payload jsonb NOT NULL,
 content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),created_by uuid NOT NULL REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(sheet_id,batch_id) REFERENCES lab_task_sheet(id,batch_id),UNIQUE(sheet_id,revision)
);
CREATE TRIGGER lab_placement_snapshot_immutable BEFORE UPDATE OR DELETE ON lab_placement_snapshot FOR EACH ROW EXECUTE FUNCTION immutable_row();

-- 5. Issued originals and derivatives (§12.20 D-66): content and file hash never change; only the status moves forward.
CREATE TABLE lab_document(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid NOT NULL REFERENCES lab_batch,sheet_id uuid REFERENCES lab_task_sheet,
 form text NOT NULL CHECK(form IN ('F2','F3')),kind text NOT NULL CHECK(kind IN ('PRE_WORK','COMPLETED')),revision integer NOT NULL CHECK(revision>0),doc_code text NOT NULL,
 snapshot jsonb NOT NULL,snapshot_hash text NOT NULL CHECK(snapshot_hash ~ '^[a-f0-9]{64}$'),file_sha256 text NOT NULL CHECK(file_sha256 ~ '^[a-f0-9]{64}$'),file_size integer NOT NULL CHECK(file_size>0),
 template_version text NOT NULL,status text NOT NULL DEFAULT 'Issued' CHECK(status IN ('Issued','StopUse','Superseded','Cancelled')),supersedes_id uuid REFERENCES lab_document,
 issued_by uuid NOT NULL REFERENCES app_user,issued_at timestamptz NOT NULL DEFAULT now(),status_reason text,status_changed_by uuid REFERENCES app_user,status_changed_at timestamptz,
 CHECK((form='F2')=(sheet_id IS NOT NULL)),CHECK(status='Issued' OR (status_changed_by IS NOT NULL AND length(trim(status_reason))>=8))
);
CREATE UNIQUE INDEX lab_document_revision ON lab_document(form,kind,batch_id,COALESCE(sheet_id,'00000000-0000-0000-0000-000000000000'::uuid),revision);
CREATE FUNCTION p4_document_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW.id,NEW.batch_id,NEW.sheet_id,NEW.form,NEW.kind,NEW.revision,NEW.doc_code,NEW.snapshot,NEW.snapshot_hash,NEW.file_sha256,NEW.file_size,NEW.template_version,NEW.supersedes_id,NEW.issued_by,NEW.issued_at)
  IS DISTINCT FROM (OLD.id,OLD.batch_id,OLD.sheet_id,OLD.form,OLD.kind,OLD.revision,OLD.doc_code,OLD.snapshot,OLD.snapshot_hash,OLD.file_sha256,OLD.file_size,OLD.template_version,OLD.supersedes_id,OLD.issued_by,OLD.issued_at)
 THEN RAISE EXCEPTION 'ISSUED_ORIGINAL_IMMUTABLE'; END IF;
 IF NEW.status<>OLD.status AND NOT ((OLD.status,NEW.status) IN (('Issued','StopUse'),('Issued','Superseded'),('Issued','Cancelled'),('StopUse','Superseded'),('StopUse','Cancelled'))) THEN RAISE EXCEPTION 'DOCUMENT_STATUS_TRANSITION_PROHIBITED'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER p4_document_guard BEFORE UPDATE ON lab_document FOR EACH ROW EXECUTE FUNCTION p4_document_guard();
CREATE TRIGGER lab_document_delete_denied BEFORE DELETE ON lab_document FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TABLE lab_document_copy(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),document_id uuid NOT NULL REFERENCES lab_document,kind text NOT NULL CHECK(kind IN ('ORIGINAL_REPRINT','WORKING_COPY','STATUS_MARKED')),
 copy_number integer CHECK(copy_number>0),file_sha256 text NOT NULL CHECK(file_sha256 ~ '^[a-f0-9]{64}$'),derived_from text NOT NULL CHECK(derived_from ~ '^[a-f0-9]{64}$'),
 actor_id uuid NOT NULL REFERENCES app_user,reason text,created_at timestamptz NOT NULL DEFAULT now(),recalled_by uuid REFERENCES app_user,recalled_at timestamptz,recall_note text,
 CHECK((kind='WORKING_COPY')=(copy_number IS NOT NULL)),CHECK(kind<>'ORIGINAL_REPRINT' OR file_sha256=derived_from),CHECK((recalled_at IS NULL)=(recalled_by IS NULL)),
 UNIQUE(document_id,copy_number)
);
CREATE FUNCTION p4_copy_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW.id,NEW.document_id,NEW.kind,NEW.copy_number,NEW.file_sha256,NEW.derived_from,NEW.actor_id,NEW.reason,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.document_id,OLD.kind,OLD.copy_number,OLD.file_sha256,OLD.derived_from,OLD.actor_id,OLD.reason,OLD.created_at)
  OR OLD.recalled_at IS NOT NULL THEN RAISE EXCEPTION 'DOCUMENT_COPY_IMMUTABLE'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER p4_copy_guard BEFORE UPDATE ON lab_document_copy FOR EACH ROW EXECUTE FUNCTION p4_copy_guard();
CREATE TRIGGER lab_document_copy_delete_denied BEFORE DELETE ON lab_document_copy FOR EACH ROW EXECUTE FUNCTION immutable_row();

-- 6. Paper-to-system reconciliation (§12.21): insert-only observations; event time is separate from recorded time.
CREATE TABLE lab_observation(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sequence bigint GENERATED ALWAYS AS IDENTITY,batch_id uuid NOT NULL REFERENCES lab_batch,sheet_id uuid REFERENCES lab_task_sheet,slot_number integer CHECK(slot_number BETWEEN 1 AND 48),
 field_id text NOT NULL CHECK(field_id ~ '^F[23]-[0-9]{2}$'),item text NOT NULL DEFAULT '' CHECK(item ~ '^[A-Z0-9_]{0,40}$'),value jsonb NOT NULL,
 source text NOT NULL CHECK(source IN ('PAPER_TRANSCRIPTION','DIRECT_ENTRY')),document_copy_id uuid REFERENCES lab_document_copy,
 event_time timestamptz,event_time_precision text NOT NULL CHECK(event_time_precision IN ('MINUTE','DAY','NOT_RECORDED')),recorded_at timestamptz NOT NULL DEFAULT now(),recorded_by uuid NOT NULL REFERENCES app_user,
 status text NOT NULL DEFAULT 'PendingReconciliation' CHECK(status IN ('PendingReconciliation','Verified','Discrepancy','Superseded')),supersedes_id uuid REFERENCES lab_observation,
 CHECK((source='PAPER_TRANSCRIPTION')=(document_copy_id IS NOT NULL)),CHECK((event_time IS NULL)=(event_time_precision='NOT_RECORDED')),
 CHECK(event_time IS NULL OR event_time<=recorded_at)
);
CREATE INDEX lab_observation_scope ON lab_observation(batch_id,field_id,slot_number) WHERE status<>'Superseded';
CREATE FUNCTION p4_observation_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE t lab_task_sheet; c lab_document_copy; d lab_document; BEGIN
 IF TG_OP='UPDATE' THEN
  IF (NEW.id,NEW.batch_id,NEW.sheet_id,NEW.slot_number,NEW.field_id,NEW.item,NEW.value,NEW.source,NEW.document_copy_id,NEW.event_time,NEW.event_time_precision,NEW.recorded_at,NEW.recorded_by,NEW.supersedes_id)
   IS DISTINCT FROM (OLD.id,OLD.batch_id,OLD.sheet_id,OLD.slot_number,OLD.field_id,OLD.item,OLD.value,OLD.source,OLD.document_copy_id,OLD.event_time,OLD.event_time_precision,OLD.recorded_at,OLD.recorded_by,OLD.supersedes_id)
  THEN RAISE EXCEPTION 'OBSERVATION_INSERT_ONLY'; END IF;
  IF NEW.status<>OLD.status AND NOT ((OLD.status,NEW.status) IN (('PendingReconciliation','Verified'),('PendingReconciliation','Discrepancy'),('PendingReconciliation','Superseded'),('Discrepancy','Superseded'),('Verified','Superseded'))) THEN RAISE EXCEPTION 'OBSERVATION_STATUS_TRANSITION_PROHIBITED'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.status<>'PendingReconciliation' THEN RAISE EXCEPTION 'OBSERVATION_STARTS_PENDING'; END IF;
 IF NEW.document_copy_id IS NOT NULL THEN
  SELECT * INTO c FROM lab_document_copy WHERE id=NEW.document_copy_id;SELECT * INTO d FROM lab_document WHERE id=c.document_id;
  IF c.kind<>'WORKING_COPY' OR d.batch_id<>NEW.batch_id OR d.status<>'Issued' OR c.recalled_at IS NOT NULL THEN RAISE EXCEPTION 'WORKING_COPY_NOT_USABLE'; END IF;
 END IF;
 IF NEW.field_id LIKE 'F2-%' THEN
  -- Plan §12.9: no execution ✓, Lot or time before the Sheet is actually in execution; never before the execution anchor.
  SELECT * INTO t FROM lab_task_sheet WHERE id=NEW.sheet_id AND batch_id=NEW.batch_id;
  IF t.id IS NULL OR t.state NOT IN ('InExecution','ExecutionRecorded') THEN RAISE EXCEPTION 'EXECUTION_NOT_STARTED'; END IF;
  IF NEW.event_time IS NOT NULL AND NEW.event_time<t.execution_started_at THEN RAISE EXCEPTION 'EVENT_BEFORE_EXECUTION_ANCHOR'; END IF;
 ELSE
  -- QC1 values exist only after the library product of the slot's Sheet was recorded.
  IF NOT EXISTS(SELECT 1 FROM lab_task_sheet ts JOIN lab_batch_slot bs ON bs.batch_id=ts.batch_id AND bs.sheet_number=ts.sheet_number WHERE ts.batch_id=NEW.batch_id
   AND (NEW.slot_number IS NULL OR bs.slot_number=NEW.slot_number) AND ts.state IN ('ExecutionRecorded','ExecutionVerified','CompletedIssued')
   AND (NEW.event_time IS NULL OR NEW.event_time>=ts.execution_ended_at)) THEN RAISE EXCEPTION 'QC1_BEFORE_LIBRARY_PRODUCT'; END IF;
 END IF;
 RETURN NEW; END $$;
CREATE TRIGGER p4_observation_guard BEFORE INSERT OR UPDATE ON lab_observation FOR EACH ROW EXECUTE FUNCTION p4_observation_guard();
CREATE TRIGGER lab_observation_delete_denied BEFORE DELETE ON lab_observation FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TABLE lab_observation_review(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),observation_id uuid NOT NULL REFERENCES lab_observation,reviewer_id uuid NOT NULL REFERENCES app_user,
 method text NOT NULL CHECK(method IN ('PAPER_COMPARE','DIRECT_CONFIRM')),result text NOT NULL CHECK(result IN ('Confirmed','Discrepancy')),
 discrepancy_kind text CHECK(discrepancy_kind IN ('VALUE_MISMATCH','MISSING','ILLEGIBLE','ID_MISMATCH','CHECK_MISSING','WRONG_REVISION')),note text,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((result='Discrepancy')=(discrepancy_kind IS NOT NULL)),CHECK(result='Confirmed' OR length(trim(note))>=8)
);
-- OD-36 is pending: the stricter proposal (a second person for every class) applies until the Owner chooses otherwise.
CREATE FUNCTION p4_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM lab_observation WHERE id=NEW.observation_id AND recorded_by=NEW.reviewer_id) THEN RAISE EXCEPTION 'SECOND_PERSON_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM lab_observation WHERE id=NEW.observation_id AND status='PendingReconciliation') THEN RAISE EXCEPTION 'OBSERVATION_NOT_PENDING'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER p4_review_guard BEFORE INSERT ON lab_observation_review FOR EACH ROW EXECUTE FUNCTION p4_review_guard();
CREATE TRIGGER lab_observation_review_immutable BEFORE UPDATE OR DELETE ON lab_observation_review FOR EACH ROW EXECUTE FUNCTION immutable_row();

-- 7. Slot disposition (§12.26). MEASURED / NOT_APPLICABLE / REQUIRED_PENDING are derived; only reasoned non-measurement is stored.
CREATE TABLE lab_slot_disposition(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid NOT NULL,slot_number integer NOT NULL,stage text NOT NULL CHECK(stage IN ('TRANSFER','QC1')),
 disposition text NOT NULL CHECK(disposition IN ('NOT_PERFORMED','EXCLUDED','STOPPED')),reason_code text NOT NULL CHECK(reason_code ~ '^[A-Z_]{3,40}$'),note text NOT NULL CHECK(length(trim(note))>=8),
 proposed_by uuid NOT NULL REFERENCES app_user,proposed_at timestamptz NOT NULL DEFAULT now(),confirmed_by uuid REFERENCES app_user,confirmed_at timestamptz,
 FOREIGN KEY(batch_id,slot_number) REFERENCES lab_batch_slot,CHECK((confirmed_at IS NULL)=(confirmed_by IS NULL)),CHECK(confirmed_by IS NULL OR confirmed_by<>proposed_by)
);
CREATE UNIQUE INDEX one_disposition_per_slot_stage ON lab_slot_disposition(batch_id,slot_number,stage);
CREATE FUNCTION p4_disposition_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' AND ((NEW.id,NEW.batch_id,NEW.slot_number,NEW.stage,NEW.disposition,NEW.reason_code,NEW.note,NEW.proposed_by,NEW.proposed_at) IS DISTINCT FROM (OLD.id,OLD.batch_id,OLD.slot_number,OLD.stage,OLD.disposition,OLD.reason_code,OLD.note,OLD.proposed_by,OLD.proposed_at) OR OLD.confirmed_at IS NOT NULL) THEN RAISE EXCEPTION 'DISPOSITION_IMMUTABLE'; END IF;
 -- §6.3 ข้อ 40: verified real data makes any non-MEASURED disposition impossible.
 IF EXISTS(SELECT 1 FROM lab_observation WHERE batch_id=NEW.batch_id AND slot_number=NEW.slot_number AND status='Verified' AND field_id=CASE NEW.stage WHEN 'TRANSFER' THEN 'F2-11' ELSE 'F3-03' END) THEN RAISE EXCEPTION 'MEASURED_SLOT_DISPOSITION_CONFLICT'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER p4_disposition_guard BEFORE INSERT OR UPDATE ON lab_slot_disposition FOR EACH ROW EXECUTE FUNCTION p4_disposition_guard();
CREATE TRIGGER lab_slot_disposition_delete_denied BEFORE DELETE ON lab_slot_disposition FOR EACH ROW EXECUTE FUNCTION immutable_row();

-- 8. QC1 criteria structure (OD-31 / WC-03) and Stage QC1 decisions. No version can be approved by this migration.
CREATE TABLE lab_qc_criteria_version(
 code text PRIMARY KEY CHECK(code ~ '^[A-Z0-9-]{3,60}$'),stage text NOT NULL CHECK(stage IN ('QC1')),status text NOT NULL CHECK(status IN ('PROPOSED_UNAPPROVED')),
 source text NOT NULL,rules jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER lab_qc_criteria_immutable BEFORE UPDATE OR DELETE ON lab_qc_criteria_version FOR EACH ROW EXECUTE FUNCTION immutable_row();
INSERT INTO lab_qc_criteria_version(code,stage,status,source,rules) VALUES
 ('QC1-WI-BM17-BM18-PROPOSED','QC1','PROPOSED_UNAPPROVED','WI-T-BM17 §12.3 / WI-T-BM18 §12.1','{"sample":{"min":"3","max":"50"},"aboveMax":"DILUTE_1_TO_1_REMEASURE","belowMin":"RE_EXTRACT","unit":"ng/uL"}'),
 ('QC1-WORKBOOK-QC-D32-D35-PROPOSED','QC1','PROPOSED_UNAPPROVED','New_Task_List_Edit (2).xlsx QC measurements!D32:D35','{"sampleAndControl":{"min":"2"},"blank":{"max":"0.6"},"unit":"ng/uL"}');
CREATE TABLE attempt_stage_qc(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),attempt_id uuid NOT NULL REFERENCES analytical_attempt,stage text NOT NULL CHECK(stage IN ('QC1')),
 decision text NOT NULL CHECK(decision IN ('Accepted','Failed','Remeasure','Hold')),observation_id uuid NOT NULL REFERENCES lab_observation,
 criteria_status text NOT NULL CHECK(criteria_status IN ('UNAPPROVED_OD31')),criteria_consulted text[] NOT NULL,reason text NOT NULL CHECK(length(trim(reason))>=8),
 decided_by uuid NOT NULL REFERENCES app_user,decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION p4_stage_qc_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM lab_observation o JOIN lab_slot_assignment a ON a.batch_id=o.batch_id AND a.slot_number=o.slot_number AND a.removed_at IS NULL
  WHERE o.id=NEW.observation_id AND o.status='Verified' AND o.field_id='F3-03' AND a.attempt_id=NEW.attempt_id) THEN RAISE EXCEPTION 'STAGE_QC_REQUIRES_VERIFIED_VALUE'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER p4_stage_qc_guard BEFORE INSERT ON attempt_stage_qc FOR EACH ROW EXECUTE FUNCTION p4_stage_qc_guard();
CREATE TRIGGER attempt_stage_qc_immutable BEFORE UPDATE OR DELETE ON attempt_stage_qc FOR EACH ROW EXECUTE FUNCTION immutable_row();

-- 9. Tube label print jobs (Owner Lock §5): per-job audit; a reprint never issues a number and requires a reason.
CREATE TABLE label_print_job(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid NOT NULL REFERENCES app_user,kind text NOT NULL CHECK(kind IN ('PRINT','REPRINT')),reason text,
 sample_count integer NOT NULL CHECK(sample_count BETWEEN 1 AND 96),include_name boolean NOT NULL,html_sha256 text NOT NULL CHECK(html_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),CHECK(kind='PRINT' OR length(trim(reason))>=8)
);
CREATE TABLE label_print_item(job_id uuid NOT NULL REFERENCES label_print_job,position integer NOT NULL CHECK(position>0),round_id uuid NOT NULL REFERENCES specimen_lab_number(round_id),
 printed_code text NOT NULL CHECK(printed_code ~ '^[0-9]{2}B[0-9]{9}D?$'),PRIMARY KEY(job_id,position),UNIQUE(job_id,round_id));
CREATE TRIGGER label_print_job_immutable BEFORE UPDATE OR DELETE ON label_print_job FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER label_print_item_immutable BEFORE UPDATE OR DELETE ON label_print_item FOR EACH ROW EXECUTE FUNCTION immutable_row();
