-- OWNER-LAB-055/059 (Owner final lock 2026-10-25): after installation an administrator corrects the HIS folder paths in
-- Settings, the worker tests them, and Save/Apply makes the running scanner/worker use them — one authorized person, as in
-- NIPTY. Only a revision that changes PATH fields alone may skip the second approver; the database itself verifies that
-- every non-path field equals the revision it replaces (or, from defaults, that live HIS I/O stays disabled). Enabling live
-- I/O, production authorisation and every other INTEGRATION/CLINICAL change keep the two-person rule. Forward-only.
CREATE FUNCTION his_path_only_change(r settings_revision, current_revision uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE paths text[]; prev settings_revision; BEGIN
 paths:=CASE r.setting_key WHEN 'his_inbound' THEN ARRAY['basePath'] WHEN 'his_outbound' THEN ARRAY['resDestinationPath','pdfDestinationPath','backupPath']
  WHEN 'result_management' THEN ARRAY['pdfSourcePath'] END;
 IF paths IS NULL OR r.reason NOT LIKE 'HIS path change: %' OR NOT r.test_passed OR r.state NOT IN ('Validated','Active')
  OR r.previous_revision_id IS DISTINCT FROM current_revision THEN RETURN false; END IF;
 IF r.previous_revision_id IS NULL THEN
  -- First change away from the built-in defaults: live HIS I/O cannot be switched on by this path.
  RETURN r.setting_key='result_management' OR (coalesce(r.value->>'enabled','false')='false' AND coalesce(r.value->>'productionAuthorized','false')='false');
 END IF;
 SELECT * INTO prev FROM settings_revision WHERE id=r.previous_revision_id;
 RETURN prev.setting_key=r.setting_key AND (prev.value - paths)=(r.value - paths);
END $$;

CREATE OR REPLACE FUNCTION settings_activation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r settings_revision; BEGIN
 SELECT * INTO r FROM settings_revision WHERE id=NEW.revision_id;
 IF r.setting_key <> NEW.setting_key OR r.state NOT IN ('Validated','Approved','Active') OR NOT r.test_passed OR r.effective_from > now() THEN RAISE EXCEPTION 'SETTING_NOT_VALIDATED'; END IF;
 IF r.risk IN ('CLINICAL','INTEGRATION') AND (r.approved_by IS NULL OR r.approved_by=r.created_by OR r.state NOT IN ('Approved','Active'))
  AND NOT his_path_only_change(r,(SELECT a.revision_id FROM setting_active a WHERE a.setting_key=NEW.setting_key)) THEN RAISE EXCEPTION 'SETTING_APPROVAL_REQUIRED'; END IF;
 IF r.setting_key='go_live_cutoff' AND EXISTS(SELECT 1 FROM nipt_case WHERE registration_origin='HISTORICAL') THEN RAISE EXCEPTION 'OD27_REQUIRED'; END IF;
 RETURN NEW;
END $$;
