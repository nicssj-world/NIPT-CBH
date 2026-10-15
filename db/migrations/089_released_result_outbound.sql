-- Extend the existing P6 journal/transport; real releases are never enrolled as synthetic fixtures.
ALTER TABLE p6_transfer ALTER COLUMN fixture_id DROP NOT NULL;
ALTER TABLE p6_transfer ADD COLUMN release_draft jsonb;
ALTER TABLE p6_transfer DROP CONSTRAINT p6_transfer_authority_check;
ALTER TABLE p6_transfer DROP CONSTRAINT p6_transfer_clinical_release_id_check;
ALTER TABLE p6_transfer DROP CONSTRAINT p6_transfer_ln_check;
ALTER TABLE p6_transfer DROP CONSTRAINT p6_transfer_report_version_id_check;
ALTER TABLE p6_transfer ADD CONSTRAINT p6_release_fk FOREIGN KEY(clinical_release_id) REFERENCES result_release(id);
CREATE UNIQUE INDEX p6_one_transfer_per_release ON p6_transfer(clinical_release_id) WHERE clinical_release_id IS NOT NULL;
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname,pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid='p6_transfer'::regclass AND contype='c' LOOP
  IF c.d LIKE '%CONTRACT_ONLY%' OR c.d LIKE '%fixtureId%' THEN EXECUTE format('ALTER TABLE p6_transfer DROP CONSTRAINT %I',c.conname); END IF;
 END LOOP;
END $$;
ALTER TABLE p6_transfer ADD CONSTRAINT p6_authority_contract CHECK(
 (authority='SANDBOX_FIXTURE_ONLY' AND fixture_id IS NOT NULL AND clinical_release_id IS NULL AND release_draft IS NULL AND plan->>'mode'='CONTRACT_ONLY' AND plan->>'fixtureId'=fixture_id)
 OR (authority='CERTIFIED_RESULT' AND fixture_id IS NULL AND clinical_release_id IS NOT NULL AND release_draft IS NOT NULL AND plan->>'mode'='OPERATIONAL_RELEASE'
  AND plan->>'fixtureId'='RELEASE-'||clinical_release_id::text));
ALTER TABLE p6_transfer ADD CONSTRAINT p6_his_ack_contract CHECK(model->>'hisConfirmed'='false');
CREATE FUNCTION p6_release_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.authority='CERTIFIED_RESULT' THEN
  IF NOT nipt_operational_enabled() OR NOT EXISTS(SELECT 1 FROM result_release r JOIN result_report_version v ON v.id=r.version_id JOIN nipt_case c ON c.id=r.case_id
    WHERE r.id=NEW.clinical_release_id AND r.state='Active' AND r.kind='RESULT' AND NOT r.synthetic AND v.state='CertifiedReleased'
     AND c.registration_origin<>'HISTORICAL' AND c.current_round_id=r.round_id AND NOT EXISTS(SELECT 1 FROM p2_revocation WHERE case_id=c.id))
  THEN RAISE EXCEPTION 'CERTIFIED_CURRENT_RELEASE_REQUIRED'; END IF;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER p6_release_insert_guard BEFORE INSERT ON p6_transfer FOR EACH ROW EXECUTE FUNCTION p6_release_insert_guard();
CREATE FUNCTION p6_release_draft_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.release_draft IS DISTINCT FROM OLD.release_draft THEN RAISE EXCEPTION 'P6_IMMUTABLE_TRANSFER'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER p6_release_draft_immutable BEFORE UPDATE ON p6_transfer FOR EACH ROW EXECUTE FUNCTION p6_release_draft_immutable();
ALTER TABLE p6_transfer ADD CONSTRAINT p6_ln_contract CHECK(ln ~ '^[0-9]{1,24}$');
ALTER TABLE p6_transfer ADD CONSTRAINT p6_report_id_contract CHECK(report_version_id ~ '^[A-Za-z0-9_-]{1,100}$');
CREATE FUNCTION p6_release_eligible(rid uuid,expected_epoch integer) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM result_release r JOIN result_report_version v ON v.id=r.version_id JOIN nipt_case c ON c.id=r.case_id
  JOIN result_qc5_review q ON q.version_id=v.id JOIN app_user u ON u.id=r.certified_by
  WHERE r.id=rid AND r.epoch=expected_epoch AND r.state='Active' AND r.kind='RESULT' AND NOT r.synthetic AND v.state='CertifiedReleased'
   AND c.registration_origin<>'HISTORICAL' AND c.current_round_id=r.round_id AND nipt_operational_enabled() AND u.enabled
   AND p2_clinical_ready(r.round_id) AND p4c_pool_current(q.dnb_id) AND p4c_handoff_verified(q.dnb_id)
   AND EXISTS(SELECT 1 FROM role_assignment a WHERE a.user_id=u.id AND a.role='LAB_CERTIFIER' AND a.approved_by IS NOT NULL AND a.effective_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now()))
   AND NOT EXISTS(SELECT 1 FROM p2_revocation WHERE case_id=r.case_id))
$$;
REVOKE ALL ON FUNCTION p6_release_eligible(uuid,integer) FROM PUBLIC;
