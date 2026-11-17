-- Owner 2026-11-17: a sample whose Sequencing succeeded but whose analysis result is abnormal can be repeated (Re-Library / Re-Extraction)
-- before the result is sent. The Sample Action Center records it as its own stage, ABNORMAL_RESULT, so it is not mistaken for a QC failure:
-- the attempt becomes QcFailed with qc_failed_stage='ABNORMAL_RESULT' and is superseded by a new attempt (-2 / -3) that goes back to the Task List.
-- Widening the two CHECK lists only; existing rows are unchanged.
ALTER TABLE analytical_attempt DROP CONSTRAINT analytical_attempt_qc_failed_stage_check;
ALTER TABLE analytical_attempt ADD CONSTRAINT analytical_attempt_qc_failed_stage_check CHECK(qc_failed_stage IN ('QC1','QC2','QC3','QC4','SEQUENCING','ABNORMAL_RESULT'));
ALTER TABLE attempt_event DROP CONSTRAINT attempt_event_stage_check;
ALTER TABLE attempt_event ADD CONSTRAINT attempt_event_stage_check CHECK(stage IN ('QC1','QC2','QC3','QC4','SEQUENCING','ABNORMAL_RESULT'));
