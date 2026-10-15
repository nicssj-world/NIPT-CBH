-- Explicit database runtime boundary. Existing data stays synthetic and immutable.
CREATE TABLE nipt_runtime_config(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),mode text NOT NULL CHECK(mode IN ('synthetic','operational')));
INSERT INTO nipt_runtime_config(singleton,mode) VALUES(true,'synthetic');
REVOKE ALL ON nipt_runtime_config FROM PUBLIC;
CREATE FUNCTION nipt_operational_enabled() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT COALESCE((SELECT mode='operational' FROM nipt_runtime_config WHERE singleton),false) $$;
ALTER TABLE p2_case_identity DROP CONSTRAINT p2_case_identity_hn_check;
ALTER TABLE p2_case_identity DROP CONSTRAINT p2_case_identity_synthetic_check;
ALTER TABLE p2_case_identity ADD CONSTRAINT p2_identity_data_contract CHECK((synthetic AND hn ~ '^0*990[0-9]{3,17}$') OR (NOT synthetic AND hn ~ '^[A-Za-z0-9][A-Za-z0-9./-]{0,31}$'));
CREATE FUNCTION p2_operational_provenance_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.synthetic = nipt_operational_enabled() THEN RAISE EXCEPTION 'RUNTIME_DATA_MODE_MISMATCH'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER p2_identity_provenance BEFORE INSERT ON p2_case_identity FOR EACH ROW EXECUTE FUNCTION p2_operational_provenance_guard();
ALTER TABLE p2_doctor_version ADD COLUMN synthetic boolean NOT NULL DEFAULT true;
ALTER TABLE p2_doctor_version DROP CONSTRAINT p2_doctor_version_doctor_key_check;
ALTER TABLE p2_doctor_version DROP CONSTRAINT p2_doctor_version_name_check;
ALTER TABLE p2_doctor_version DROP CONSTRAINT p2_doctor_version_authorization_evidence_check;
ALTER TABLE p2_doctor_version ADD CONSTRAINT p2_doctor_data_contract CHECK(
 length(trim(name)) BETWEEN 1 AND 500 AND length(trim(authorization_evidence)) BETWEEN 1 AND 500
 AND ((synthetic AND doctor_key ~ '^SYNTHETIC-[A-Z0-9-]+$' AND (name LIKE 'SYNTHETIC%' OR name LIKE 'จำลอง%') AND authorization_evidence LIKE 'SYNTHETIC%')
 OR (NOT synthetic AND doctor_key ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')));
CREATE TRIGGER p2_doctor_provenance BEFORE INSERT ON p2_doctor_version FOR EACH ROW EXECUTE FUNCTION p2_operational_provenance_guard();
-- Defaults follow the database marker, so legacy INSERT paths cannot mislabel real records.
DO $$ DECLARE item record; guard record; BEGIN
 FOR item IN SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='synthetic' AND data_type='boolean' LOOP
  EXECUTE format('ALTER TABLE %I ALTER COLUMN synthetic SET DEFAULT (NOT nipt_operational_enabled())',item.table_name);
  FOR guard IN SELECT conname FROM pg_constraint WHERE conrelid=to_regclass('public.'||quote_ident(item.table_name)) AND contype='c' AND pg_get_constraintdef(oid) IN ('CHECK (synthetic)','CHECK ((synthetic = true))') LOOP
   EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',item.table_name,guard.conname);
  END LOOP;
  IF item.table_name NOT IN ('p2_case_identity','p2_doctor_version') THEN
   EXECUTE format('CREATE TRIGGER operational_provenance BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION p2_operational_provenance_guard()',item.table_name);
  END IF;
 END LOOP;
END $$;
