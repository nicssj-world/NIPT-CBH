-- Task 3 (Owner 2026-10-25): two permanent result pathways on the ONE existing P5 ledger.
--   A. INTERNAL_GENERATED: frozen HALOS export -> archived HALOS XLSX -> versioned interpretation -> Owner DOCX master -> signed PDF.
--   B. EXTERNAL_READYGEN: the existing external PDF/ZIP intake, including imports after a NIPT-CBH outage.
-- Forward only. Constraints replaced below are verified by exact definition first; anything else stops the migration.
-- No clinical rule, template/product compatibility or signature authority is approved here: every new path fails closed.
DO $$ DECLARE expected jsonb:=jsonb_build_object(
  'result_report_version_link_mode_check','CHECK ((link_mode = ANY (ARRAY[''MANUAL_REVIEWED''::text, ''AUTO_PIC''::text, ''AUTO_UNIQUE''::text])))',
  'result_link_event_event_check','CHECK ((event = ANY (ARRAY[''PROPOSED''::text, ''APPROVED''::text, ''REJECTED''::text, ''UNLINKED''::text, ''AUTO_LINKED''::text])))',
  'result_link_event_mode_check','CHECK (((mode = ANY (ARRAY[''MANUAL_REVIEWED''::text, ''AUTO_UNIQUE''::text])) AND ((mode = ''AUTO_UNIQUE''::text) = (event = ''AUTO_LINKED''::text))))',
  'result_link_event_outcome_required','CHECK (((event = ANY (ARRAY[''APPROVED''::text, ''AUTO_LINKED''::text])) = (outcome IS NOT NULL)))',
  'result_link_event_evidence_auto_only','CHECK (((match_evidence IS NOT NULL) = (event = ''AUTO_LINKED''::text)))',
  'result_intake_file_source_check','CHECK ((source = ANY (ARRAY[''FOLDER''::text, ''UPLOAD''::text])))',
  'result_access_log_purpose_check','CHECK ((purpose = ANY (ARRAY[''ANC_RESULT_LIST''::text, ''ANC_RESULT_FILE''::text, ''LAB_REVIEW_FILE''::text])))');
 k text; found text;
BEGIN
 FOR k IN SELECT jsonb_object_keys(expected) LOOP
  SELECT pg_get_constraintdef(oid) INTO found FROM pg_constraint WHERE conname=k AND conrelid IN ('result_report_version'::regclass,'result_link_event'::regclass,'result_intake_file'::regclass,'result_access_log'::regclass);
  IF found IS DISTINCT FROM expected->>k THEN RAISE EXCEPTION 'MIGRATION_128_UNEXPECTED_CONSTRAINT %',k; END IF;
 END LOOP;
END $$;

-- 1. Truthful origin of every report version. Every existing version came through the external PDF/ZIP intake.
ALTER TABLE result_report_version ADD COLUMN origin text NOT NULL DEFAULT 'EXTERNAL_READYGEN' CHECK(origin IN ('EXTERNAL_READYGEN','INTERNAL_GENERATED'));
ALTER TABLE result_intake_file DROP CONSTRAINT result_intake_file_source_check;
ALTER TABLE result_intake_file ADD CONSTRAINT result_intake_file_source_check CHECK(source IN ('FOLDER','UPLOAD','INTERNAL_GENERATED'));
-- The origin always equals the intake channel: an imported PDF can never be relabelled internal, nor the reverse.
CREATE FUNCTION task3_version_origin_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' AND NEW.origin IS DISTINCT FROM OLD.origin THEN RAISE EXCEPTION 'REPORT_ORIGIN_IMMUTABLE'; END IF;
 IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM result_intake_file i WHERE i.id=NEW.intake_file_id AND (i.source='INTERNAL_GENERATED')=(NEW.origin='INTERNAL_GENERATED')) THEN RAISE EXCEPTION 'REPORT_ORIGIN_CHANNEL_MISMATCH'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER task3_version_origin_guard BEFORE INSERT OR UPDATE ON result_report_version FOR EACH ROW EXECUTE FUNCTION task3_version_origin_guard();

-- 2. Original HALOS "Sample analysis data" workbook, archived byte-for-byte in the FileStore (file_asset) before parsing.
CREATE TABLE halos_import(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sha256 text NOT NULL REFERENCES file_asset(sha256),
 original_name text NOT NULL CHECK(length(original_name) BETWEEN 1 AND 255 AND original_name !~ '[\r\n\0/\\]'),byte_size bigint NOT NULL CHECK(byte_size>0),
 adapter_version text NOT NULL CHECK(length(adapter_version) BETWEEN 8 AND 80),chip_ids text[] NOT NULL,counts jsonb NOT NULL,issues jsonb NOT NULL DEFAULT '[]',
 state text NOT NULL DEFAULT 'Previewed' CHECK(state IN ('Previewed','Confirmed','Cancelled')),
 uploaded_by uuid NOT NULL REFERENCES app_user,uploaded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 decided_by uuid REFERENCES app_user,decided_at timestamptz,row_version integer NOT NULL DEFAULT 0 CHECK(row_version>=0),
 synthetic boolean NOT NULL DEFAULT (NOT nipt_operational_enabled()),
 CHECK((state='Previewed')=(decided_by IS NULL) AND (decided_by IS NULL)=(decided_at IS NULL))
);
-- An identical file can be open only once; a cancelled preview can be uploaded again.
CREATE UNIQUE INDEX halos_import_one_live_file ON halos_import(sha256) WHERE state<>'Cancelled';
CREATE FUNCTION task3_halos_import_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (to_jsonb(NEW)-'state'-'decided_by'-'decided_at'-'row_version')<>(to_jsonb(OLD)-'state'-'decided_by'-'decided_at'-'row_version') OR OLD.state<>'Previewed' OR NEW.state='Previewed' OR NEW.row_version<>OLD.row_version+1
 THEN RAISE EXCEPTION 'HALOS_IMPORT_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER task3_halos_import_guard BEFORE UPDATE ON halos_import FOR EACH ROW EXECUTE FUNCTION task3_halos_import_guard();
CREATE TRIGGER halos_import_delete_denied BEFORE DELETE ON halos_import FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER operational_provenance BEFORE INSERT ON halos_import FOR EACH ROW EXECUTE FUNCTION p2_operational_provenance_guard();

-- Every row of result / repeat / sampleinfo keeps its raw cells, sheet, row number and its frozen-export resolution.
CREATE TABLE halos_import_row(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),import_id uuid NOT NULL REFERENCES halos_import,
 sheet text NOT NULL CHECK(sheet IN ('result','repeat','sampleinfo')),row_number integer NOT NULL CHECK(row_number>=2),raw jsonb NOT NULL,
 sample_raw text NOT NULL CHECK(length(sample_raw) BETWEEN 1 AND 120),sample_key text NOT NULL CHECK(length(sample_key) BETWEEN 1 AND 120),
 chip_id text,lane_id text,barcode text,
 classification text NOT NULL CHECK(classification IN ('PATIENT','CONTROL','UNMATCHED','AMBIGUOUS','STALE_EXPORT','SUPERSEDED_ATTEMPT','DUPLICATE_ENTRY','REPEAT_HISTORY','SAMPLE_INFO','INVALID')),
 reason text NOT NULL CHECK(reason ~ '^[A-Z0-9_]{2,80}$'),
 attempt_id uuid REFERENCES analytical_attempt,round_id uuid,case_id uuid,export_kind text CHECK(export_kind IN ('LAB_SEQ_EXPORT_PAIR','P4B_HALOS_EXPORT')),export_id uuid,mapping jsonb,
 primary_row_id uuid REFERENCES halos_import_row,sampleinfo_row_id uuid REFERENCES halos_import_row,
 synthetic boolean NOT NULL DEFAULT (NOT nipt_operational_enabled()),
 UNIQUE(import_id,sheet,row_number),FOREIGN KEY(round_id,case_id) REFERENCES specimen_round(id,case_id),
 CHECK((classification='PATIENT')<=(attempt_id IS NOT NULL AND round_id IS NOT NULL AND export_id IS NOT NULL AND mapping IS NOT NULL)),
 CHECK(classification<>'CONTROL' OR attempt_id IS NULL)
);
CREATE INDEX halos_import_row_attempt ON halos_import_row(attempt_id) WHERE attempt_id IS NOT NULL;
CREATE TRIGGER halos_import_row_immutable BEFORE UPDATE OR DELETE ON halos_import_row FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER operational_provenance BEFORE INSERT ON halos_import_row FOR EACH ROW EXECUTE FUNCTION p2_operational_provenance_guard();

-- 3. Report signer profiles. The signer submits their own legal name, MT licence and signature; an administrator verifies.
--    Content rows are immutable; a new profile version is a new row. Signature bytes live in the FileStore.
CREATE TABLE report_signer_profile(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES app_user,version integer NOT NULL CHECK(version>0),
 legal_name text NOT NULL CHECK(length(trim(legal_name)) BETWEEN 3 AND 120 AND legal_name !~ '[\r\n\0()]'),
 mt_license_no text NOT NULL CHECK(mt_license_no ~ '^[0-9]{3,10}$'),
 signature_sha256 text NOT NULL REFERENCES file_asset(sha256),signature_media text NOT NULL CHECK(signature_media IN ('image/png','image/jpeg')),
 submitted_by uuid NOT NULL REFERENCES app_user,submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 synthetic boolean NOT NULL DEFAULT (NOT nipt_operational_enabled()),
 UNIQUE(user_id,version),CHECK(submitted_by=user_id)
);
CREATE TRIGGER report_signer_profile_immutable BEFORE UPDATE OR DELETE ON report_signer_profile FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER operational_provenance BEFORE INSERT ON report_signer_profile FOR EACH ROW EXECUTE FUNCTION p2_operational_provenance_guard();
CREATE TABLE report_signer_profile_event(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sequence bigint GENERATED ALWAYS AS IDENTITY,profile_id uuid NOT NULL REFERENCES report_signer_profile,
 event text NOT NULL CHECK(event IN ('VERIFIED','REVOKED')),reason text NOT NULL CHECK(length(trim(reason))>=8),actor_id uuid NOT NULL REFERENCES app_user,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER report_signer_profile_event_immutable BEFORE UPDATE OR DELETE ON report_signer_profile_event FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE FUNCTION task3_signer_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE p report_signer_profile; BEGIN
 SELECT * INTO p FROM report_signer_profile WHERE id=NEW.profile_id;
 -- Nobody verifies their own signature; a profile is verified once and a revocation is final.
 IF NEW.event='VERIFIED' AND (NEW.actor_id=p.user_id OR EXISTS(SELECT 1 FROM report_signer_profile_event WHERE profile_id=NEW.profile_id)) THEN RAISE EXCEPTION 'SIGNER_VERIFICATION_INVALID'; END IF;
 IF NEW.event='REVOKED' AND EXISTS(SELECT 1 FROM report_signer_profile_event WHERE profile_id=NEW.profile_id AND event='REVOKED') THEN RAISE EXCEPTION 'SIGNER_ALREADY_REVOKED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER task3_signer_event_guard BEFORE INSERT ON report_signer_profile_event FOR EACH ROW EXECUTE FUNCTION task3_signer_event_guard();
-- Current usable profile: the newest version of the user that is verified and not revoked.
CREATE FUNCTION task3_signer_profile_current(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM report_signer_profile p JOIN app_user u ON u.id=p.user_id WHERE p.id=target AND u.enabled
  AND p.version=(SELECT max(x.version) FROM report_signer_profile x WHERE x.user_id=p.user_id)
  AND EXISTS(SELECT 1 FROM report_signer_profile_event e WHERE e.profile_id=p.id AND e.event='VERIFIED')
  AND NOT EXISTS(SELECT 1 FROM report_signer_profile_event e WHERE e.profile_id=p.id AND e.event='REVOKED'))
$$;

-- Standing delegation: the signer personally authorises an operator to apply the signer's stored signature, citing the
-- hospital's documented authority. Only the grantor can create it; the grantor or an administrator can revoke it.
CREATE TABLE report_signature_delegation(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),grantor_id uuid NOT NULL REFERENCES app_user,grantee_id uuid NOT NULL REFERENCES app_user,
 roles text[] NOT NULL CHECK(roles <@ ARRAY['REPORTED','APPROVED']::text[] AND cardinality(roles) BETWEEN 1 AND 2),
 authority_reference text NOT NULL CHECK(length(trim(authority_reference)) BETWEEN 8 AND 300),
 effective_from timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz,created_by uuid NOT NULL REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 revoked_at timestamptz,revoked_by uuid REFERENCES app_user,revoke_reason text,
 CHECK(grantor_id<>grantee_id),CHECK(created_by=grantor_id),CHECK(expires_at IS NULL OR expires_at>effective_from),
 CHECK((revoked_at IS NULL)=(revoked_by IS NULL) AND (revoked_at IS NULL)=(revoke_reason IS NULL))
);
CREATE FUNCTION task3_delegation_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'IMMUTABLE_RECORD'; END IF;
 IF (to_jsonb(NEW)-'revoked_at'-'revoked_by'-'revoke_reason')<>(to_jsonb(OLD)-'revoked_at'-'revoked_by'-'revoke_reason') OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN RAISE EXCEPTION 'DELEGATION_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER task3_delegation_guard BEFORE UPDATE OR DELETE ON report_signature_delegation FOR EACH ROW EXECUTE FUNCTION task3_delegation_guard();

-- 4. Internally generated reports. One row per FINAL patient PDF; previews and HOLD decisions are not reports.
--    Each row freezes the analytic source, the approved interpretation, the DOCX master, every printed value and the signers.
CREATE TABLE internal_report_batch(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),operator_id uuid NOT NULL REFERENCES app_user,idempotency_key uuid NOT NULL UNIQUE,
 requested jsonb NOT NULL,outcome jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 synthetic boolean NOT NULL DEFAULT (NOT nipt_operational_enabled())
);
CREATE TRIGGER internal_report_batch_immutable BEFORE UPDATE OR DELETE ON internal_report_batch FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER operational_provenance BEFORE INSERT ON internal_report_batch FOR EACH ROW EXECUTE FUNCTION p2_operational_provenance_guard();
CREATE TABLE internal_report(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),halos_row_id uuid NOT NULL REFERENCES halos_import_row,
 attempt_id uuid NOT NULL REFERENCES analytical_attempt,round_id uuid NOT NULL,case_id uuid NOT NULL,
 template_kind text NOT NULL CHECK(template_kind IN ('SINGLETON','TWIN')),template_code text NOT NULL CHECK(template_code IN ('FM-WI-T-BM-17-07','FM-WI-T-BM-17-08')),
 template_sha256 text NOT NULL CHECK(template_sha256 ~ '^[a-f0-9]{64}$'),
 pregnancy_source text NOT NULL CHECK(pregnancy_source IN ('ANC_REQUEST','AUTHORIZED_OVERRIDE')),pregnancy_override_reason text,
 interpretation jsonb NOT NULL,ruleset jsonb NOT NULL,bindings jsonb NOT NULL,
 operator_id uuid NOT NULL REFERENCES app_user,
 reported_by uuid NOT NULL REFERENCES app_user,reported_profile_id uuid NOT NULL REFERENCES report_signer_profile,reported_authority jsonb NOT NULL,reported_at timestamptz NOT NULL,
 approved_by uuid NOT NULL REFERENCES app_user,approved_profile_id uuid NOT NULL REFERENCES report_signer_profile,approved_authority jsonb NOT NULL,approved_at timestamptz NOT NULL,
 pdf_sha256 text NOT NULL UNIQUE REFERENCES file_asset(sha256),download_name text NOT NULL CHECK(length(download_name) BETWEEN 5 AND 180),
 state text NOT NULL DEFAULT 'Final' CHECK(state IN ('Final','Voided','Superseded')),version_id uuid UNIQUE REFERENCES result_report_version,
 supersedes_id uuid REFERENCES internal_report,batch_id uuid REFERENCES internal_report_batch DEFERRABLE INITIALLY DEFERRED,state_reason text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),synthetic boolean NOT NULL DEFAULT (NOT nipt_operational_enabled()),
 FOREIGN KEY(round_id,case_id) REFERENCES specimen_round(id,case_id),
 CHECK((pregnancy_source='AUTHORIZED_OVERRIDE')=(pregnancy_override_reason IS NOT NULL AND length(trim(pregnancy_override_reason))>=8)),
 CHECK(approved_at>=reported_at),CHECK((template_kind='SINGLETON')=(template_code='FM-WI-T-BM-17-07')),
 CHECK((state='Final')=(state_reason IS NULL))
);
-- At most one Final internal report per attempt; a re-issue supersedes the earlier one, which stays readable.
CREATE UNIQUE INDEX internal_report_one_final ON internal_report(attempt_id) WHERE state='Final';
CREATE FUNCTION task3_internal_report_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'IMMUTABLE_RECORD'; END IF;
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM halos_import_row r JOIN halos_import i ON i.id=r.import_id WHERE r.id=NEW.halos_row_id AND r.classification='PATIENT' AND i.state='Confirmed'
   AND r.attempt_id=NEW.attempt_id AND r.round_id=NEW.round_id AND r.case_id=NEW.case_id) THEN RAISE EXCEPTION 'INTERNAL_REPORT_CONFIRMED_PATIENT_ROW_REQUIRED'; END IF;
  IF NOT task3_signer_profile_current(NEW.reported_profile_id) OR NOT task3_signer_profile_current(NEW.approved_profile_id)
   OR NOT EXISTS(SELECT 1 FROM report_signer_profile WHERE id=NEW.reported_profile_id AND user_id=NEW.reported_by)
   OR NOT EXISTS(SELECT 1 FROM report_signer_profile WHERE id=NEW.approved_profile_id AND user_id=NEW.approved_by) THEN RAISE EXCEPTION 'SIGNER_PROFILE_NOT_CURRENT'; END IF;
  IF NEW.state<>'Final' OR NEW.version_id IS NOT NULL THEN RAISE EXCEPTION 'INTERNAL_REPORT_STARTS_FINAL'; END IF;
  RETURN NEW;
 END IF;
 -- Content never changes. The ledger link is set once; Final may become Voided or Superseded with a reason.
 IF (to_jsonb(NEW)-'state'-'state_reason'-'version_id')<>(to_jsonb(OLD)-'state'-'state_reason'-'version_id')
  OR (OLD.version_id IS NOT NULL AND NEW.version_id IS DISTINCT FROM OLD.version_id)
  OR (NEW.state<>OLD.state AND (OLD.state<>'Final' OR NEW.state NOT IN ('Voided','Superseded'))) THEN RAISE EXCEPTION 'INTERNAL_REPORT_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER task3_internal_report_guard BEFORE INSERT OR UPDATE OR DELETE ON internal_report FOR EACH ROW EXECUTE FUNCTION task3_internal_report_guard();
CREATE TRIGGER operational_provenance BEFORE INSERT ON internal_report FOR EACH ROW EXECUTE FUNCTION p2_operational_provenance_guard();
-- An internal version is backed by exactly one Final internal report with the same bytes.
CREATE FUNCTION task3_internal_version_current(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM result_report_version v JOIN internal_report r ON r.version_id=v.id
  WHERE v.id=target AND v.origin='INTERNAL_GENERATED' AND r.state='Final' AND r.pdf_sha256=v.sha256 AND r.attempt_id=v.attempt_id
  AND (r.interpretation->>'status')='FINAL_ELIGIBLE' AND (r.ruleset->>'approved')='true' AND (r.ruleset->>'combinationApproved')='true')
$$;

-- 5. FROZEN_EXPORT link: an internal report is linked to the attempt that its HALOS row was resolved to through the persisted
--    export mapping. No identity guessing; still only an unlinked final in an empty series of the current round/latest attempt.
ALTER TABLE result_report_version DROP CONSTRAINT result_report_version_link_mode_check;
ALTER TABLE result_report_version ADD CONSTRAINT result_report_version_link_mode_check CHECK(link_mode IN ('MANUAL_REVIEWED','AUTO_PIC','AUTO_UNIQUE','FROZEN_EXPORT'));
ALTER TABLE result_link_event DROP CONSTRAINT result_link_event_event_check;
ALTER TABLE result_link_event ADD CONSTRAINT result_link_event_event_check CHECK(event IN ('PROPOSED','APPROVED','REJECTED','UNLINKED','AUTO_LINKED','FROZEN_EXPORT_LINKED'));
ALTER TABLE result_link_event DROP CONSTRAINT result_link_event_mode_check;
ALTER TABLE result_link_event ADD CONSTRAINT result_link_event_mode_check CHECK(mode IN ('MANUAL_REVIEWED','AUTO_UNIQUE','FROZEN_EXPORT') AND (mode='AUTO_UNIQUE')=(event='AUTO_LINKED') AND (mode='FROZEN_EXPORT')=(event='FROZEN_EXPORT_LINKED'));
ALTER TABLE result_link_event DROP CONSTRAINT result_link_event_outcome_required;
ALTER TABLE result_link_event ADD CONSTRAINT result_link_event_outcome_required CHECK((event IN ('APPROVED','AUTO_LINKED','FROZEN_EXPORT_LINKED'))=(outcome IS NOT NULL));
ALTER TABLE result_link_event DROP CONSTRAINT result_link_event_evidence_auto_only;
ALTER TABLE result_link_event ADD CONSTRAINT result_link_event_evidence_system_only CHECK((match_evidence IS NOT NULL)=(event IN ('AUTO_LINKED','FROZEN_EXPORT_LINKED')));
ALTER TABLE result_link_event ADD CONSTRAINT result_link_event_frozen_export CHECK(event<>'FROZEN_EXPORT_LINKED' OR (outcome='Linked' AND round_id IS NOT NULL AND case_id IS NOT NULL AND attempt_id IS NOT NULL
 AND revision IS NULL AND name_review IS NULL AND jsonb_typeof(match_evidence)='object' AND match_evidence ? 'halosRowId' AND match_evidence ? 'exportId'));
DO $$ DECLARE d text; BEGIN
 SELECT pg_get_functiondef('p5_link_event_guard()'::regprocedure) INTO d;
 IF position($q$NEW.event IN ('PROPOSED','AUTO_LINKED')$q$ in d)=0 OR position($q$x.event IN ('APPROVED','REJECTED','UNLINKED','AUTO_LINKED')$q$ in d)=0 THEN RAISE EXCEPTION 'TASK3_LINK_GUARD_SHAPE_MISMATCH'; END IF;
 d:=replace(d,$q$NEW.event IN ('PROPOSED','AUTO_LINKED')$q$,$q$NEW.event IN ('PROPOSED','AUTO_LINKED','FROZEN_EXPORT_LINKED')$q$);
 d:=replace(d,$q$x.event IN ('APPROVED','REJECTED','UNLINKED','AUTO_LINKED')$q$,$q$x.event IN ('APPROVED','REJECTED','UNLINKED','AUTO_LINKED','FROZEN_EXPORT_LINKED')$q$);
 d:=replace(d,'BEGIN',$body$BEGIN
 IF NEW.event='FROZEN_EXPORT_LINKED' THEN
  IF NOT EXISTS(SELECT 1 FROM result_report_version v JOIN internal_report r ON r.version_id=v.id JOIN halos_import_row h ON h.id=r.halos_row_id
   WHERE v.id=NEW.version_id AND v.origin='INTERNAL_GENERATED' AND v.state='Unlinked' AND v.kind='RESULT' AND v.round_id IS NULL AND r.state='Final'
   AND r.attempt_id=NEW.attempt_id AND r.round_id=NEW.round_id AND r.case_id=NEW.case_id AND h.id::text=NEW.match_evidence->>'halosRowId' AND h.export_id::text=NEW.match_evidence->>'exportId')
  THEN RAISE EXCEPTION 'FROZEN_EXPORT_LINK_REQUIRES_INTERNAL_REPORT'; END IF;
  IF EXISTS(SELECT 1 FROM result_report_version o WHERE o.round_id=NEW.round_id AND o.kind='RESULT' AND o.id<>NEW.version_id) THEN RAISE EXCEPTION 'FROZEN_EXPORT_LINK_SERIES_NOT_EMPTY'; END IF;
  IF EXISTS(SELECT 1 FROM result_link_event x WHERE x.version_id=NEW.version_id) THEN RAISE EXCEPTION 'FROZEN_EXPORT_LINK_AFTER_OTHER_DECISION'; END IF;
  IF NOT EXISTS(SELECT 1 FROM analytical_attempt a JOIN specimen_round r ON r.id=a.round_id JOIN nipt_case c ON c.id=r.case_id
   WHERE a.id=NEW.attempt_id AND r.id=NEW.round_id AND c.id=NEW.case_id AND c.current_round_id=r.id AND c.registration_origin<>'HISTORICAL'
   AND a.attempt_number=(SELECT max(b.attempt_number) FROM analytical_attempt b WHERE b.round_id=r.id)) THEN RAISE EXCEPTION 'FROZEN_EXPORT_LINK_TARGET_NOT_CURRENT'; END IF;
 END IF;
 $body$);
 EXECUTE d;
END $$;
CREATE FUNCTION task3_frozen_link_mode_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE e result_link_event; BEGIN
 IF NEW.link_mode='FROZEN_EXPORT' AND OLD.link_mode IS DISTINCT FROM 'FROZEN_EXPORT' THEN
  SELECT * INTO e FROM result_link_event WHERE version_id=NEW.id ORDER BY sequence DESC LIMIT 1;
  IF e.id IS NULL OR e.event<>'FROZEN_EXPORT_LINKED' OR e.round_id IS DISTINCT FROM NEW.round_id OR e.attempt_id IS DISTINCT FROM NEW.attempt_id OR e.case_id IS DISTINCT FROM NEW.case_id OR NEW.state<>'Linked' OR NEW.origin<>'INTERNAL_GENERATED'
  THEN RAISE EXCEPTION 'FROZEN_EXPORT_LINK_EVENT_REQUIRED'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER task3_frozen_link_mode_guard BEFORE UPDATE OF link_mode ON result_report_version FOR EACH ROW EXECUTE FUNCTION task3_frozen_link_mode_guard();
-- A No Call review counts after any link decision, including the frozen-export link.
DO $$ DECLARE d text; BEGIN
 SELECT pg_get_functiondef('task1_no_call_qc5_valid(result_qc5_review)'::regprocedure) INTO d;
 IF position($q$e.event IN ('APPROVED','AUTO_LINKED')$q$ in d)=0 THEN RAISE EXCEPTION 'TASK3_NO_CALL_GUARD_SHAPE_MISMATCH'; END IF;
 EXECUTE replace(d,$q$e.event IN ('APPROVED','AUTO_LINKED')$q$,$q$e.event IN ('APPROVED','AUTO_LINKED','FROZEN_EXPORT_LINKED')$q$);
END $$;

-- 6. Release of an internal report requires its current Final internal record (approved interpretation, approved
--    template/product combination, frozen signers). Prepended; every existing release guard still runs afterwards.
DO $$ DECLARE d text; BEGIN
 SELECT pg_get_functiondef('p5_operational_release_guard()'::regprocedure) INTO d;
 IF position('BEGIN' in d)=0 THEN RAISE EXCEPTION 'TASK3_RELEASE_GUARD_SHAPE_MISMATCH'; END IF;
 d:=replace(d,'BEGIN',$body$BEGIN
 IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM result_report_version v WHERE v.id=NEW.version_id AND v.origin='INTERNAL_GENERATED') AND NOT task3_internal_version_current(NEW.version_id) THEN
  RAISE EXCEPTION 'INTERNAL_REPORT_AUTHORITY_REQUIRED';
 END IF;
 $body$);EXECUTE d;
END $$;

-- 7. Outage provenance of an external PDF produced by ReadyGen while NIPT-CBH was unavailable. Never required for an import.
CREATE TABLE result_external_fallback(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),version_id uuid NOT NULL UNIQUE REFERENCES result_report_version,
 external_system text NOT NULL CHECK(external_system='READYGEN'),outage_reference text NOT NULL CHECK(length(trim(outage_reference)) BETWEEN 8 AND 300),
 outage_started_at timestamptz,outage_ended_at timestamptz,package_sha256 text CHECK(package_sha256 ~ '^[a-f0-9]{64}$'),note text CHECK(note IS NULL OR length(note)<=500),
 recorded_by uuid NOT NULL REFERENCES app_user,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),synthetic boolean NOT NULL DEFAULT (NOT nipt_operational_enabled()),
 CHECK(outage_ended_at IS NULL OR outage_started_at IS NULL OR outage_ended_at>=outage_started_at)
);
CREATE FUNCTION task3_fallback_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM result_report_version v WHERE v.id=NEW.version_id AND v.origin='EXTERNAL_READYGEN') THEN RAISE EXCEPTION 'FALLBACK_REQUIRES_EXTERNAL_VERSION'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER task3_fallback_guard BEFORE INSERT ON result_external_fallback FOR EACH ROW EXECUTE FUNCTION task3_fallback_guard();
CREATE TRIGGER result_external_fallback_immutable BEFORE UPDATE OR DELETE ON result_external_fallback FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER operational_provenance BEFORE INSERT ON result_external_fallback FOR EACH ROW EXECUTE FUNCTION p2_operational_provenance_guard();

-- 8. "มีผลใน HIS แล้ว": an authorised user's attestation that HIS already holds this exact result. It is the user's statement,
--    not automatic HIS proof. It suppresses outbound delivery for the version; it is refused once a transfer exists.
CREATE TABLE result_his_attestation(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),version_id uuid NOT NULL REFERENCES result_report_version,round_id uuid NOT NULL,case_id uuid NOT NULL,
 statement text NOT NULL CHECK(statement='มีผลใน HIS แล้ว'),his_state text NOT NULL CHECK(his_state='PRESENT_IN_HIS'),
 note text CHECK(note IS NULL OR length(note)<=500),evidence_sha256 text REFERENCES file_asset(sha256),
 effect text NOT NULL CHECK(effect IN ('SUPPRESSED_BEFORE_RELEASE','SUPPRESSED_PENDING_DELIVERY')),
 actor_id uuid NOT NULL REFERENCES app_user,attested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 withdrawn_at timestamptz,withdrawn_by uuid REFERENCES app_user,withdraw_reason text,synthetic boolean NOT NULL DEFAULT (NOT nipt_operational_enabled()),
 FOREIGN KEY(round_id,case_id) REFERENCES specimen_round(id,case_id),
 CHECK((withdrawn_at IS NULL)=(withdrawn_by IS NULL) AND (withdrawn_at IS NULL)=(withdraw_reason IS NULL))
);
CREATE UNIQUE INDEX result_his_attestation_active ON result_his_attestation(version_id) WHERE withdrawn_at IS NULL;
CREATE FUNCTION task3_attestation_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'IMMUTABLE_RECORD'; END IF;
 IF EXISTS(SELECT 1 FROM p6_transfer t JOIN result_release r ON r.id=t.clinical_release_id WHERE r.version_id=NEW.version_id) THEN RAISE EXCEPTION 'HIS_ATTESTATION_TRANSFER_EXISTS'; END IF;
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM result_report_version v WHERE v.id=NEW.version_id AND v.kind='RESULT' AND v.round_id=NEW.round_id AND v.case_id=NEW.case_id
   AND v.state IN ('Linked','ValidationBlocked','PendingCertification','CertifiedReleased')) THEN RAISE EXCEPTION 'HIS_ATTESTATION_LINKED_RESULT_REQUIRED'; END IF;
  RETURN NEW;
 END IF;
 IF (to_jsonb(NEW)-'withdrawn_at'-'withdrawn_by'-'withdraw_reason')<>(to_jsonb(OLD)-'withdrawn_at'-'withdrawn_by'-'withdraw_reason') OR OLD.withdrawn_at IS NOT NULL OR NEW.withdrawn_at IS NULL THEN RAISE EXCEPTION 'HIS_ATTESTATION_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER task3_attestation_guard BEFORE INSERT OR UPDATE OR DELETE ON result_his_attestation FOR EACH ROW EXECUTE FUNCTION task3_attestation_guard();
CREATE TRIGGER operational_provenance BEFORE INSERT ON result_his_attestation FOR EACH ROW EXECUTE FUNCTION p2_operational_provenance_guard();
CREATE FUNCTION task3_his_presence_attested(version uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM result_his_attestation WHERE version_id=version AND withdrawn_at IS NULL)
$$;
REVOKE ALL ON FUNCTION task3_his_presence_attested(uuid) FROM PUBLIC;
-- No transfer can ever be reserved for an attested version, whatever path tries.
DO $$ DECLARE d text; BEGIN
 SELECT pg_get_functiondef('p6_release_insert_guard()'::regprocedure) INTO d;
 IF position('BEGIN' in d)=0 THEN RAISE EXCEPTION 'TASK3_P6_GUARD_SHAPE_MISMATCH'; END IF;
 d:=replace(d,'BEGIN',$body$BEGIN
 IF NEW.clinical_release_id IS NOT NULL AND EXISTS(SELECT 1 FROM result_release r WHERE r.id=NEW.clinical_release_id AND task3_his_presence_attested(r.version_id)) THEN
  RAISE EXCEPTION 'HIS_PRESENCE_ATTESTED_NO_OUTBOUND';
 END IF;
 $body$);EXECUTE d;
END $$;

-- 9. Access evidence for the ANC download / print-view and the LAB original-file reads introduced here.
ALTER TABLE result_access_log DROP CONSTRAINT result_access_log_purpose_check;
ALTER TABLE result_access_log ADD CONSTRAINT result_access_log_purpose_check CHECK(purpose IN ('ANC_RESULT_LIST','ANC_RESULT_FILE','LAB_REVIEW_FILE','ANC_RESULT_DOWNLOAD','ANC_RESULT_PRINT_VIEW','LAB_HALOS_SOURCE_FILE','LAB_INTERNAL_PREVIEW'));

DO $$ BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN
 GRANT SELECT,INSERT ON halos_import_row,report_signer_profile,report_signer_profile_event,internal_report_batch,result_external_fallback TO app_rw;
 GRANT SELECT,INSERT,UPDATE ON halos_import,report_signature_delegation,internal_report,result_his_attestation TO app_rw;
 GRANT USAGE ON SEQUENCE report_signer_profile_event_sequence_seq TO app_rw;
 GRANT EXECUTE ON FUNCTION task3_his_presence_attested(uuid),task3_signer_profile_current(uuid),task3_internal_version_current(uuid) TO app_rw;
END IF;
IF EXISTS(SELECT FROM pg_roles WHERE rolname='worker_rw') THEN
 GRANT SELECT ON result_his_attestation TO worker_rw;
 GRANT EXECUTE ON FUNCTION task3_his_presence_attested(uuid) TO worker_rw;
END IF;
IF EXISTS(SELECT FROM pg_roles WHERE rolname='report_ro') THEN
 GRANT SELECT ON halos_import,halos_import_row,internal_report,internal_report_batch,result_external_fallback,result_his_attestation TO report_ro;
END IF; END $$;
