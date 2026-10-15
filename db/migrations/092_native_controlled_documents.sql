-- Native Master artifacts are the operational document authority; legacy simulation originals remain immutable.
CREATE FUNCTION native_workbook_document_valid(s jsonb,h text,b uuid,f text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT COALESCE(s->>'nativeMaster'='true' AND s->>'synthetic'='false' AND s->>'form'=f AND s->>'batchId'=b::text AND EXISTS(
 SELECT 1 FROM task_workbook_export p JOIN task_workbook_export x ON x.revision_id=p.revision_id JOIN task_workbook_revision r ON r.id=p.revision_id
 WHERE p.id::text=s->>'pdfExportId' AND x.id::text=s->>'xlsxExportId' AND p.format='PDF' AND x.format='XLSX'
 AND r.batch_id=b AND r.master_sha256='2f8aef50243c89eae6a4e9115d65fbf9239754a1bd9ce330205378f3a9b3aacf'
 AND s->>'masterSha256'=r.master_sha256 AND p.file_sha256=h AND s->>'pdfSha256'=h AND s->>'xlsxSha256'=x.file_sha256
 AND s->>'sourceSha256'=r.source_sha256 AND s->>'workbookRevision'=r.revision::text AND p.sheet=s->>'sheet'
 AND p.sheet=CASE f WHEN 'F3' THEN 'QC measurements' WHEN 'F4' THEN 'Pooling Table' WHEN 'F5' THEN 'Seq Task-G50' ELSE p.sheet END),false)
$$;
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conrelid::regclass t,conname,pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid IN ('p4b_document'::regclass,'p4c_document'::regclass) AND contype='c' LOOP
  IF c.d LIKE '%snapshot%' AND c.d LIKE '%synthetic%' THEN
   EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',c.t,c.conname);
   EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I CHECK((%s) OR COALESCE(snapshot->>''nativeMaster''=''true'' AND snapshot->>''synthetic''=''false'',false))',c.t,c.conname,substring(c.d FROM 8 FOR length(c.d)-8));
  END IF;
 END LOOP;
END $$;
CREATE FUNCTION controlled_native_issue_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE b uuid;f text; BEGIN
 IF TG_TABLE_NAME='lab_document' THEN b=NEW.batch_id;f=NEW.form;
 ELSIF TG_TABLE_NAME='p4b_document' THEN SELECT batch_id INTO b FROM p4b_pool_attempt WHERE id=NEW.pool_id;f='F4';
 ELSE SELECT batch_id INTO b FROM p4c_dnb_attempt WHERE id=NEW.dnb_id;f='F5'; END IF;
 IF nipt_operational_enabled() AND NOT native_workbook_document_valid(NEW.snapshot,NEW.file_sha256,b,f) THEN RAISE EXCEPTION 'NATIVE_CONTROLLED_DOCUMENT_REQUIRED'; END IF;
 IF NEW.snapshot->>'nativeMaster'='true' THEN
  IF NOT nipt_operational_enabled() OR NOT native_workbook_document_valid(NEW.snapshot,NEW.file_sha256,b,f) OR NEW.snapshot->>'kind' IS DISTINCT FROM NEW.kind THEN RAISE EXCEPTION 'NATIVE_CONTROLLED_DOCUMENT_INVALID'; END IF;
  IF TG_TABLE_NAME='p4b_document' THEN
   IF NEW.snapshot->>'poolId' IS DISTINCT FROM NEW.pool_id::text THEN RAISE EXCEPTION 'NATIVE_DOCUMENT_POOL_MISMATCH'; END IF;
  ELSIF TG_TABLE_NAME='p4c_document' THEN
   IF NEW.snapshot->>'dnbId' IS DISTINCT FROM NEW.dnb_id::text THEN RAISE EXCEPTION 'NATIVE_DOCUMENT_DNB_MISMATCH'; END IF;
  ELSIF f='F2' THEN
   IF NEW.snapshot->>'sheet' IS DISTINCT FROM (SELECT 'Ext. & Prep. Task List '||sheet_number::text FROM lab_task_sheet WHERE id=NEW.sheet_id) THEN RAISE EXCEPTION 'NATIVE_DOCUMENT_SHEET_MISMATCH'; END IF;
  END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER controlled_native_issue_guard BEFORE INSERT ON lab_document FOR EACH ROW EXECUTE FUNCTION controlled_native_issue_guard();
CREATE TRIGGER controlled_native_issue_guard BEFORE INSERT ON p4b_document FOR EACH ROW EXECUTE FUNCTION controlled_native_issue_guard();
CREATE TRIGGER controlled_native_issue_guard BEFORE INSERT ON p4c_document FOR EACH ROW EXECUTE FUNCTION controlled_native_issue_guard();

-- Preserve synthetic readiness while connecting operational F5 to current accepted observed HALOS/QC4 evidence.
ALTER FUNCTION p4c_f5_ready(uuid) RENAME TO p4c_f5_ready_legacy;
CREATE FUNCTION p4c_f5_ready(did uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN (SELECT purpose FROM p4c_dnb_attempt WHERE id=did)='OPERATIONAL' THEN COALESCE((
 WITH run AS (SELECT id FROM p4c_sequencing_attempt WHERE dnb_id=did ORDER BY attempt_number DESC LIMIT 1),
 mapped AS (SELECT e.source->'members' members FROM p4b_halos_export e JOIN p4c_dnb_attempt d ON d.pool_snapshot_id=e.pool_snapshot_id WHERE d.id=did AND e.dnb_date=d.actual_date ORDER BY e.revision DESC LIMIT 1),
 current_qc AS (SELECT o.*,r.result FROM p4c_qc4_observation o LEFT JOIN p4c_qc4_review r ON r.qc4_id=o.id WHERE o.sequencing_id=(SELECT id FROM run) AND NOT EXISTS(SELECT 1 FROM p4c_qc4_observation x WHERE x.supersedes_id=o.id))
 SELECT nipt_operational_enabled() AND p4c_pool_current(did) AND p4c_qc3_ready(did) AND p4c_handoff_verified(did)
 AND EXISTS(SELECT 1 FROM p4c_dnb_event WHERE dnb_id=did AND event_type='DNB_END')
 AND EXISTS(SELECT 1 FROM p4c_dnb_event WHERE dnb_id=did AND event_type='SEQUENCE_END' AND payload->>'sequencingId'=(SELECT id::text FROM run))
 AND NOT EXISTS(SELECT 1 FROM p4c_dnb_event WHERE dnb_id=did AND event_type='SEQUENCE_HOLD' AND payload->>'sequencingId'=(SELECT id::text FROM run))
 AND EXISTS(SELECT 1 FROM current_qc WHERE scope='LANE' AND result='Accepted' AND event_time IS NOT NULL)
 AND (SELECT jsonb_array_length(members)=47 FROM mapped) IS TRUE
 AND NOT EXISTS(SELECT 1 FROM mapped,jsonb_array_elements(members) m WHERE NOT EXISTS(SELECT 1 FROM current_qc o WHERE scope='SAMPLE' AND member_key=m->>'memberKey' AND result='Accepted' AND event_time IS NOT NULL))
 AND NOT EXISTS(SELECT 1 FROM current_qc WHERE result IS DISTINCT FROM 'Accepted' OR event_time IS NULL)
 ),false) ELSE p4c_f5_ready_legacy(did) END
$$;
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('p4c_f5_guard()'::regprocedure) INTO definition;
 definition:=replace(definition,'BEGIN',$native$BEGIN
 IF NEW.snapshot->>'nativeMaster'='true' THEN
  SELECT * INTO d FROM p4c_dnb_attempt WHERE id=NEW.dnb_id;
  PERFORM id FROM lab_batch WHERE id=d.batch_id FOR UPDATE;
  IF NOT nipt_operational_enabled() OR NOT p4c_pool_current(d.id) OR NOT native_workbook_document_valid(NEW.snapshot,NEW.file_sha256,d.batch_id,'F5') THEN RAISE EXCEPTION 'NATIVE_CONTROLLED_DOCUMENT_INVALID'; END IF;
  IF NEW.snapshot->>'docId' IS DISTINCT FROM NEW.id::text OR NEW.snapshot->>'dnbId' IS DISTINCT FROM d.id::text OR NEW.snapshot->>'poolSnapshotId' IS DISTINCT FROM d.pool_snapshot_id::text OR NEW.snapshot->>'poolHash' IS DISTINCT FROM d.source_sha256 OR (NEW.snapshot->>'revision')::int IS DISTINCT FROM NEW.revision THEN RAISE EXCEPTION 'F5_SOURCE_MISMATCH'; END IF;
  IF NEW.kind='PRE_WORK' THEN
   IF EXISTS(SELECT 1 FROM p4c_dnb_event WHERE dnb_id=d.id AND event_type='DNB_START') THEN RAISE EXCEPTION 'PRE_WORK_BEFORE_EXECUTION_ONLY'; END IF;
  ELSIF p4c_f5_ready(d.id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'F5_COMPLETION_EVIDENCE_INCOMPLETE'; END IF;
  RETURN NEW;
 END IF;
 $native$);
 EXECUTE definition;
END $$;
-- p4c_f5_current_preview_guard remains unchanged and verifies actor, kind, hash and its database evidence token.
