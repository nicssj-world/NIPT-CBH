-- Owner 2026-11-13: the first specimen round may be repeated twice (Re-Library/Re-Extraction), so its third attempt prints -3
-- (-1 → -2 → -3, as on the pre-printed tube stickers). A resampled specimen (R) still prints only R-1/R-2, and the bare R stays.
-- Only the format CHECK is replaced; no row changes, and every existing printed ID matches the wider pattern.
ALTER TABLE analytical_attempt DROP CONSTRAINT analytical_attempt_printed_sample_id_check;
ALTER TABLE analytical_attempt ADD CONSTRAINT analytical_attempt_printed_sample_id_check CHECK(printed_sample_id ~ '^[0-9]{2}B[0-9]{9}D?(R?-[12]|-3|R)$');
