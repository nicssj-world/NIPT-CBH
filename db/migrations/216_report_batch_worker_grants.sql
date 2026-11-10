-- Report batch items (migration 199) are finalized by the Worker: it must read the operator's authority and run the same finalization the web role runs.
-- Found by running a queued item under the real worker_rw role; Production refused its first query (permission denied for table role_assignment).
-- Read-only on authority tables; no DELETE anywhere; no write to role_assignment, user_permission or user_unit_scope.
-- roles.sql repeats these grants after role creation on a fresh installation.
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='worker_rw') THEN
  EXECUTE 'GRANT SELECT ON role_assignment,user_unit_scope,user_permission,internal_report_batch,halos_import_row,halos_import,analytical_attempt,p2_workspace,p2_doctor_version,attempt_event,case_unit_scope,internal_report,clinical_snapshot,p2_document_revision,p2_paper_review,p2_final_consent,p2_collection_fact,halos_row_dismissal,report_signer_profile,report_signer_profile_event,report_signature_delegation,result_version_event,result_link_event,result_qc5_review,result_review,specimen_lab_number,repeat_work_order,lab_slot_assignment,lab_batch,lab_task_sheet,specimen_acceptance,lab_placement_snapshot,label_print_item,label_print_job,attempt_stage_qc,lab_slot_disposition,lab_bench_review,p4b_pool_attempt,result_gate_evaluation,task_workbook_revision,lab_batch_removal,lab_bench_export,lab_actual_pooling TO worker_rw';
  EXECUTE 'GRANT INSERT ON internal_report,result_report_version,result_version_event,result_link_event,result_gate_evaluation,result_review,lab_bench_review,result_qc5_review,internal_report_batch TO worker_rw';
  EXECUTE 'GRANT UPDATE ON internal_report,nipt_case,analytical_attempt,result_report_version,lab_batch TO worker_rw';
  EXECUTE 'GRANT EXECUTE ON FUNCTION task1_no_call_qc5_valid(result_qc5_review) TO worker_rw';
  EXECUTE 'GRANT EXECUTE ON FUNCTION migration_result_source_current(uuid) TO worker_rw';
  EXECUTE 'GRANT EXECUTE ON FUNCTION migration_result_review_current(uuid) TO worker_rw';
  EXECUTE 'GRANT EXECUTE ON FUNCTION task1_no_call_source(uuid) TO worker_rw';
 END IF;
END $$;
