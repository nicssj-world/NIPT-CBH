-- Owner 2026-10-27: system configuration is managed by the APP_ADMIN alone. Saving a validated change activates it at once: no second approver,
-- no mandatory reason, no worker test queue. Forward-only; no data and no active setting is changed here.
--
-- The authority is decided by the database, not by the request: the revision's author must hold a CURRENT APP_ADMIN assignment on an enabled account.
-- Only the keys below are system configuration. Clinical interpretation, consent, result management rules, historical backfill, go-live cutoff and the
-- doctor registry keep the two-person rule. Production authorisation of HIS outbound (releasing results to a production HIS) also keeps it: it may be
-- switched on only through the existing approval path, never by a direct save. The change must be made on top of the revision that is active now.
CREATE FUNCTION admin_direct_setting_change(r settings_revision, current_revision uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE prev settings_revision; BEGIN
 IF r.setting_key NOT IN ('general','security','notifications','report_output','his_inbound','his_outbound','laboratory') THEN RETURN false; END IF;
 IF NOT r.test_passed OR r.state NOT IN ('Validated','Active') OR r.previous_revision_id IS DISTINCT FROM current_revision THEN RETURN false; END IF;
 IF NOT EXISTS (SELECT 1 FROM role_assignment ra JOIN app_user u ON u.id=ra.user_id
   WHERE ra.user_id=r.created_by AND ra.role='APP_ADMIN' AND u.enabled AND ra.effective_from<=now() AND (ra.expires_at IS NULL OR ra.expires_at>now())) THEN RETURN false; END IF;
 IF r.setting_key='his_outbound' AND coalesce(r.value->>'productionAuthorized','false')='true' THEN
  IF current_revision IS NULL THEN RETURN false; END IF;
  SELECT * INTO prev FROM settings_revision WHERE id=current_revision;
  IF coalesce(prev.value->>'productionAuthorized','false')<>'true' THEN RETURN false; END IF;
 END IF;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION settings_activation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r settings_revision; cur uuid; BEGIN
 SELECT * INTO r FROM settings_revision WHERE id=NEW.revision_id;
 IF r.setting_key <> NEW.setting_key OR r.state NOT IN ('Validated','Approved','Active') OR NOT r.test_passed OR r.effective_from > now() THEN RAISE EXCEPTION 'SETTING_NOT_VALIDATED'; END IF;
 cur:=(SELECT a.revision_id FROM setting_active a WHERE a.setting_key=NEW.setting_key);
 IF r.risk IN ('CLINICAL','INTEGRATION') AND (r.approved_by IS NULL OR r.approved_by=r.created_by OR r.state NOT IN ('Approved','Active'))
  AND NOT his_path_only_change(r,cur) AND NOT admin_direct_setting_change(r,cur) THEN RAISE EXCEPTION 'SETTING_APPROVAL_REQUIRED'; END IF;
 IF r.setting_key='go_live_cutoff' AND EXISTS(SELECT 1 FROM nipt_case WHERE registration_origin='HISTORICAL') THEN RAISE EXCEPTION 'OD27_REQUIRED'; END IF;
 RETURN NEW;
END $$;
