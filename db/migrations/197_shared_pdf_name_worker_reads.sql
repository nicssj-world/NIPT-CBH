-- Shared CFS/download naming reads the exact report attempt and its run. No clinical writes or gate changes.
DO $$ BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname='worker_rw') THEN
 GRANT SELECT(version_id,download_name,bindings,template_code) ON internal_report TO worker_rw;
 GRANT SELECT(id,run_number,run_year) ON lab_batch TO worker_rw;
 GRANT SELECT(attempt_id,batch_id,removed_at) ON lab_slot_assignment TO worker_rw;
 GRANT SELECT(round_id,ln_halos) ON specimen_lab_number TO worker_rw;
END IF; END $$;
