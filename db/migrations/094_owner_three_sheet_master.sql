-- Historical exports remain immutable. Only new revisions require the composed owner master.
ALTER TABLE task_workbook_revision DROP CONSTRAINT task_workbook_revision_master_sha256_check;
ALTER TABLE task_workbook_revision ADD CONSTRAINT task_workbook_revision_master_sha256_check CHECK(master_sha256 IN (
 '2747a9f6c6da9231996bd9d0a23b1da3100d910209d440643c70158f7fe20722',
 '2f8aef50243c89eae6a4e9115d65fbf9239754a1bd9ce330205378f3a9b3aacf',
 '0f94efbc240b9a38ff9be77bf0c8d92c09d82fa2fe2427b9d274cc739e5607a6'));
CREATE OR REPLACE FUNCTION task_workbook_current_master_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.master_sha256<>'0f94efbc240b9a38ff9be77bf0c8d92c09d82fa2fe2427b9d274cc739e5607a6' THEN
  RAISE EXCEPTION 'TASK_CURRENT_MASTER_REQUIRED';
 END IF; RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION native_workbook_document_valid(s jsonb,h text,b uuid,f text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT COALESCE(s->>'nativeMaster'='true' AND s->>'synthetic'='false' AND s->>'form'=f AND s->>'batchId'=b::text AND EXISTS(
 SELECT 1 FROM task_workbook_export p JOIN task_workbook_export x ON x.revision_id=p.revision_id JOIN task_workbook_revision r ON r.id=p.revision_id
 WHERE p.id::text=s->>'pdfExportId' AND x.id::text=s->>'xlsxExportId' AND p.format='PDF' AND x.format='XLSX'
 AND r.batch_id=b AND r.master_sha256 IN ('2f8aef50243c89eae6a4e9115d65fbf9239754a1bd9ce330205378f3a9b3aacf','0f94efbc240b9a38ff9be77bf0c8d92c09d82fa2fe2427b9d274cc739e5607a6')
 AND s->>'masterSha256'=r.master_sha256 AND p.file_sha256=h AND s->>'pdfSha256'=h AND s->>'xlsxSha256'=x.file_sha256
 AND s->>'sourceSha256'=r.source_sha256 AND s->>'workbookRevision'=r.revision::text AND p.sheet=s->>'sheet'
 AND p.sheet=CASE f WHEN 'F3' THEN 'QC measurements' WHEN 'F4' THEN 'Pooling Table' WHEN 'F5' THEN 'Seq Task-G50' ELSE p.sheet END),false)
$$;
