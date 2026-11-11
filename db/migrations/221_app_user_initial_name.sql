-- Owner 2026-11-11: each person sets an Initial Name (e.g. SJ) in their own Profile: English capital letters, 1-5, never used by two people.
-- The Lab operator fields (Task List 1-3, QC Measurements, Pooling, Sequencing) show the chosen people as their Initial Names joined by " / " (e.g. "SJ / SC").
ALTER TABLE app_user ADD COLUMN initial_name text CHECK(initial_name IS NULL OR initial_name ~ '^[A-Z]{1,5}$');
CREATE UNIQUE INDEX app_user_initial_name_unique ON app_user(initial_name) WHERE initial_name IS NOT NULL;
