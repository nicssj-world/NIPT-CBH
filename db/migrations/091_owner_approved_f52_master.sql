-- Preserve immutable revisions/exports from the former owner master.
ALTER TABLE task_workbook_revision DROP CONSTRAINT task_workbook_revision_master_sha256_check;
ALTER TABLE task_workbook_revision ADD CONSTRAINT task_workbook_revision_master_sha256_check CHECK(master_sha256 IN (
 '2747a9f6c6da9231996bd9d0a23b1da3100d910209d440643c70158f7fe20722',
 '2f8aef50243c89eae6a4e9115d65fbf9239754a1bd9ce330205378f3a9b3aacf'));
CREATE FUNCTION task_workbook_current_master_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.master_sha256<>'2f8aef50243c89eae6a4e9115d65fbf9239754a1bd9ce330205378f3a9b3aacf' THEN
  RAISE EXCEPTION 'TASK_CURRENT_MASTER_REQUIRED';
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER task_workbook_current_master_guard BEFORE INSERT ON task_workbook_revision FOR EACH ROW EXECUTE FUNCTION task_workbook_current_master_guard();
