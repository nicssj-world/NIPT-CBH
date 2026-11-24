-- Tube photos without a Run (Owner 2026-11-24): Lab photographs the tubes (rack and labels) before placing them in a Task, when no Run exists yet.
-- Such a photo needs no Run; the uploader states the LN Halos range of the tubes in it ("ตั้งแต่ X ถึง Y") and a sample search finds it by that range.
-- LN Halos is YYBYYMMDDNNN (migration 082): the 12-character base sorts by receipt date and monthly order, so a text range is ordered within a month
-- and across months. Suffixes (D, -1, -2, R) are not part of the range. A range may also be stated on a Run photo; it is required only without a Run,
-- otherwise the photo could not be found. The sample order 1-48 counts positions in a Task, so a photo without a Run cannot state one.
-- Forward-only and additive: every existing photo keeps its Run and has no range.
ALTER TABLE run_photo ALTER COLUMN batch_id DROP NOT NULL;
ALTER TABLE run_photo ADD COLUMN ln_halos_from text,ADD COLUMN ln_halos_to text;
ALTER TABLE run_photo ADD CONSTRAINT run_photo_ln_halos_format CHECK(
 (ln_halos_from IS NULL AND ln_halos_to IS NULL)
 OR (ln_halos_from ~ '^[0-9]{2}B[0-9]{9}$' AND ln_halos_to ~ '^[0-9]{2}B[0-9]{9}$' AND ln_halos_from<=ln_halos_to));
ALTER TABLE run_photo ADD CONSTRAINT run_photo_without_run_has_range CHECK(batch_id IS NOT NULL OR ln_halos_from IS NOT NULL);
ALTER TABLE run_photo ADD CONSTRAINT run_photo_without_run_no_sample_order CHECK(batch_id IS NOT NULL OR sample_from IS NULL);
-- The same bytes cannot be filed twice without a Run (as run_photo_one_active_copy does within one Run).
CREATE UNIQUE INDEX run_photo_one_active_copy_without_run ON run_photo(sha256) WHERE state='Active' AND batch_id IS NULL;
CREATE INDEX run_photo_by_ln_halos_range ON run_photo(ln_halos_from,ln_halos_to) WHERE ln_halos_from IS NOT NULL;
