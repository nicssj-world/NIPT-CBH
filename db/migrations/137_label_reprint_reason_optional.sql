-- OWNER-LAB-025: first print is "พิมพ์", later prints are "พิมพ์ซ้ำ"; a reprint no longer needs an arbitrary 8-character
-- reason. Every print/reprint job, its items and the actor/time stay recorded (unchanged tables and audit). Forward-only.
ALTER TABLE label_print_job DROP CONSTRAINT label_print_job_check;
ALTER TABLE label_print_job ADD CONSTRAINT label_print_job_reason_check CHECK(reason IS NULL OR length(trim(reason)) BETWEEN 1 AND 500);
