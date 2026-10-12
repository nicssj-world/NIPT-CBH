-- P3 synthetic HIS inbound build (Plan v6.2.1 §5.5, §6.2 D, §10.1-§10.2). Additive only.
-- Numbered 090 to stay clear of P2 (006/007 at authoring); renumber to the next sequential slot at P2 integration.
ALTER TABLE his_inbound_file DROP CONSTRAINT his_inbound_file_state_check;
ALTER TABLE his_inbound_file ADD CONSTRAINT his_inbound_file_state_check CHECK(state IN ('Ready','Applied(S1)','Conflict','ParseError','DuplicateSameContent','Unlinked','S1IntegrityEvent','HistoricalIntake'));
ALTER TABLE his_inbound_file
 ADD COLUMN ln text CHECK(ln ~ '^[0-9]+$'),
 ADD COLUMN source_path text CHECK(source_path ~* '^inbound/[0-9]{8}/[0-9]+-[0-9]+\.pet$'),
 ADD COLUMN path_version integer CHECK(path_version>0),
 ADD COLUMN byte_size integer CHECK(byte_size>=0),
 ADD COLUMN parser_version text,
 ADD COLUMN error_code text CHECK(error_code ~ '^[A-Z0-9_]{1,64}$'),
 ADD COLUMN case_id uuid REFERENCES nipt_case,
 ADD COLUMN discovered_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN processed_at timestamptz;
CREATE INDEX his_inbound_file_ln ON his_inbound_file(ln,discovered_at);
CREATE INDEX his_inbound_file_open ON his_inbound_file(state) WHERE state IN ('Ready','Unlinked');
-- Plan §6.2 D: Unique (path, sha256). Identical bytes seen again at any path are recorded, never re-applied.
CREATE TABLE his_inbound_source(
 source_path text NOT NULL CHECK(source_path ~* '^inbound/[0-9]{8}/[0-9]+-[0-9]+\.pet$'),sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 inbound_file_id uuid REFERENCES his_inbound_file,byte_size integer NOT NULL CHECK(byte_size>=0),source_mtime timestamptz NOT NULL,first_seen_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(source_path,sha256)
);
CREATE TRIGGER his_inbound_source_immutable BEFORE UPDATE OR DELETE ON his_inbound_source FOR EACH ROW EXECUTE FUNCTION immutable_row();
-- .pet seen without its .ok sentinel; never read until .ok exists (LOCKED §7.1, LD-02).
CREATE TABLE his_inbound_waiting(source_path text PRIMARY KEY CHECK(source_path ~* '^inbound/[0-9]{8}/[0-9]+-[0-9]+\.pet$'),first_seen_at timestamptz NOT NULL,last_seen_at timestamptz NOT NULL,ok_seen_at timestamptz,CHECK(last_seen_at>=first_seen_at));
CREATE TABLE his_inbound_scan_run(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),trigger text NOT NULL CHECK(trigger IN ('INTERVAL','MANUAL','DEEP')),lookback_days integer NOT NULL CHECK(lookback_days BETWEEN 1 AND 90),
 started_at timestamptz NOT NULL,finished_at timestamptz NOT NULL,outcome text NOT NULL CHECK(outcome IN ('SUCCESS','PARTIAL','SHARE_UNAVAILABLE','FAILED','SKIPPED_BACKOFF')),
 counts jsonb NOT NULL DEFAULT '{}',error_code text CHECK(error_code ~ '^[A-Z0-9_]{1,64}$'),actor_id uuid REFERENCES app_user,synthetic boolean NOT NULL DEFAULT true CHECK(synthetic),CHECK(finished_at>=started_at)
);
CREATE INDEX his_inbound_scan_run_time ON his_inbound_scan_run(finished_at DESC);
CREATE TRIGGER his_inbound_scan_run_immutable BEFORE UPDATE OR DELETE ON his_inbound_scan_run FOR EACH ROW EXECUTE FUNCTION immutable_row();
-- Plan §6.2 D his_intake_issue. Details hold field names only, never HIS values.
CREATE TABLE his_intake_issue(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),inbound_file_id uuid NOT NULL REFERENCES his_inbound_file,ln text NOT NULL CHECK(ln ~ '^[0-9]+$'),
 kind text NOT NULL CHECK(kind IN ('IDENTITY_MISMATCH','LN_REUSED_OR_CHANGED','LN_REUSED_DIFFERENT_PATIENT','UNLINKED','IDENTITY_UNVERIFIED','S1_INTEGRITY_EVENT','HISTORICAL_LN_INTAKE')),
 case_id uuid REFERENCES nipt_case,state text NOT NULL DEFAULT 'Open' CHECK(state IN ('Open','Proposed','Resolved','AutoClosed')),
 details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),closed_at timestamptz,
 UNIQUE(inbound_file_id,kind),CHECK((state IN ('Resolved','AutoClosed'))=(closed_at IS NOT NULL))
);
CREATE INDEX his_intake_issue_open ON his_intake_issue(state,created_at) WHERE state IN ('Open','Proposed');
CREATE FUNCTION his_intake_issue_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.inbound_file_id<>OLD.inbound_file_id OR NEW.ln<>OLD.ln OR NEW.kind<>OLD.kind OR NEW.created_at<>OLD.created_at OR (OLD.case_id IS NOT NULL AND NEW.case_id IS DISTINCT FROM OLD.case_id) THEN RAISE EXCEPTION 'immutable intake issue lineage'; END IF;
 IF OLD.state IN ('Resolved','AutoClosed') THEN RAISE EXCEPTION 'closed intake issue'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER his_intake_issue_guard BEFORE UPDATE ON his_intake_issue FOR EACH ROW EXECUTE FUNCTION his_intake_issue_guard();
CREATE TRIGGER his_intake_issue_delete_denied BEFORE DELETE ON his_intake_issue FOR EACH ROW EXECUTE FUNCTION immutable_row();
-- D-18 two-person resolution: append-only events; approval needs a different person's proposal of the same action.
CREATE TABLE his_intake_issue_event(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sequence bigint GENERATED ALWAYS AS IDENTITY,issue_id uuid NOT NULL REFERENCES his_intake_issue,
 event text NOT NULL CHECK(event IN ('OPENED','PROPOSED','APPROVED','REJECTED','AUTO_CLOSED')),
 action text CHECK(action IN ('link_case','keep_existing','acknowledge','dismiss')),case_id uuid REFERENCES nipt_case,
 actor_id uuid REFERENCES app_user,reason text,details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(event NOT IN ('PROPOSED','APPROVED','REJECTED') OR (actor_id IS NOT NULL AND length(trim(reason))>0)),
 CHECK(event NOT IN ('PROPOSED','APPROVED') OR action IS NOT NULL)
);
CREATE FUNCTION his_intake_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE p his_intake_issue_event; BEGIN
 IF NEW.event IN ('APPROVED','REJECTED') THEN
  SELECT * INTO p FROM his_intake_issue_event WHERE issue_id=NEW.issue_id AND event='PROPOSED' ORDER BY sequence DESC LIMIT 1;
  IF p.id IS NULL OR EXISTS(SELECT 1 FROM his_intake_issue_event WHERE issue_id=NEW.issue_id AND event IN ('APPROVED','REJECTED') AND sequence>p.sequence) THEN RAISE EXCEPTION 'RESOLUTION_PROPOSAL_REQUIRED'; END IF;
  IF p.actor_id=NEW.actor_id THEN RAISE EXCEPTION 'SECOND_PERSON_REQUIRED'; END IF;
  IF NEW.event='APPROVED' AND (p.action<>NEW.action OR p.case_id IS DISTINCT FROM NEW.case_id) THEN RAISE EXCEPTION 'RESOLUTION_MISMATCH'; END IF;
 END IF; RETURN NEW; END $$;
CREATE TRIGGER his_intake_event_guard BEFORE INSERT ON his_intake_issue_event FOR EACH ROW EXECUTE FUNCTION his_intake_event_guard();
CREATE TRIGGER his_intake_issue_event_immutable BEFORE UPDATE OR DELETE ON his_intake_issue_event FOR EACH ROW EXECUTE FUNCTION immutable_row();
-- AT-HISIN-11 / LD-04: members of worker_rw never write rounds >= 2. Superusers are not implicit members here.
CREATE FUNCTION p3_worker_session() RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT current_user='worker_rw' OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles u ON u.oid=m.member WHERE r.rolname='worker_rw' AND u.rolname=current_user) $$;
CREATE FUNCTION p3_worker_round_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.round_number>=2 AND p3_worker_session() THEN RAISE EXCEPTION 'WORKER_ROUND2_PROHIBITED'; END IF;
 IF TG_OP='UPDATE' AND OLD.round_number>=2 AND p3_worker_session() THEN RAISE EXCEPTION 'WORKER_ROUND2_PROHIBITED'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER p3_worker_round_guard BEFORE INSERT OR UPDATE ON specimen_round FOR EACH ROW EXECUTE FUNCTION p3_worker_round_guard();
