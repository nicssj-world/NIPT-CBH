-- ลงผลสปสช.: the page lists every case ANC counts as "มีผลตรวจแล้ว" - a certified NIPT-CBH release AND a result that HIS already holds / the previous system reported
-- (historical_reported_result, which has no release). The latter is identified by its result version, so an entry event now points at either a release or a version.
-- Additive: existing events keep their release_id. A new event has exactly one of the two.
ALTER TABLE nhso_result_entry_event ALTER COLUMN release_id DROP NOT NULL;
ALTER TABLE nhso_result_entry_event ADD COLUMN version_id uuid REFERENCES result_report_version(id);
ALTER TABLE nhso_result_entry_event ADD CONSTRAINT nhso_event_one_subject CHECK((release_id IS NULL)<>(version_id IS NULL));
CREATE INDEX nhso_result_entry_event_version ON nhso_result_entry_event(version_id,sequence DESC) WHERE version_id IS NOT NULL;
