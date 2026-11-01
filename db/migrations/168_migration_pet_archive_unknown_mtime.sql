-- A supplied PET archive does not prove the original file's filesystem mtime.
-- Keep that timestamp unknown rather than substituting import or specimen time.
ALTER TABLE his_inbound_source ALTER COLUMN source_mtime DROP NOT NULL;
ALTER TABLE his_inbound_source ADD CONSTRAINT inbound_source_known_mtime_or_migration_archive
 CHECK(source_mtime IS NOT NULL OR source_id='MIGRATION_ARCHIVE');
