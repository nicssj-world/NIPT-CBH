-- OWNER-LAB-055/059 (Owner final lock 2026-10-25): a certified release reserved while the HIS outbound folder was wrong
-- must reach the folder the administrator corrected in Settings, exactly once. The worker already cancels a pre-OK
-- transfer whose frozen settings no longer match (GATE_CHANGED/CONFIG_CHANGED; an OK-bearing one goes to
-- RECONCILIATION_REQUIRED instead). This allows ONE new transfer for that release under the new settings, and only when
-- every earlier transfer of the release is CANCELLED by such a configuration change — never after an OK was written,
-- never for reconciliation/admin-failed transfers and never twice under the same settings version. Forward-only.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='p6_transfer'::regclass AND contype='u'
  AND pg_get_constraintdef(oid)='UNIQUE (sandbox_id, ln, ln_generation, report_version_id)' LOOP
  EXECUTE format('ALTER TABLE p6_transfer DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
CREATE UNIQUE INDEX p6_one_open_transfer_per_report ON p6_transfer(sandbox_id,ln,ln_generation,report_version_id) WHERE model->>'state'<>'CANCELLED';
DROP INDEX p6_one_transfer_per_release;
CREATE UNIQUE INDEX p6_one_open_transfer_per_release ON p6_transfer(clinical_release_id) WHERE clinical_release_id IS NOT NULL AND model->>'state'<>'CANCELLED';

CREATE FUNCTION p6_release_reroute_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.clinical_release_id IS NOT NULL AND EXISTS(SELECT 1 FROM p6_transfer t WHERE t.clinical_release_id=NEW.clinical_release_id AND (
   t.model->>'state'<>'CANCELLED' OR t.plan->>'settingsVersion'=NEW.plan->>'settingsVersion'
   OR NOT EXISTS(SELECT 1 FROM p6_transfer_event e WHERE e.transfer_id=t.id AND e.code='GATE_CHANGED' AND e.event->>'reason'='CONFIG_CHANGED')))
 THEN RAISE EXCEPTION 'P6_RELEASE_ALREADY_TRANSFERRED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER p6_release_reroute_guard BEFORE INSERT ON p6_transfer FOR EACH ROW EXECUTE FUNCTION p6_release_reroute_guard();
