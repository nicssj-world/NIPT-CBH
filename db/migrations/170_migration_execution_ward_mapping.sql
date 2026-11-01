-- Persist only the administrator's explicit PET ward-to-unit mapping for restart-safe enrichment.
ALTER TABLE migration_execution ADD COLUMN ward_mappings jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(ward_mappings)='object');
