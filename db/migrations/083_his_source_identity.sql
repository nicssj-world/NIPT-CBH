-- Separate physical source identities without relaxing the existing relative-path grammar.
-- Existing simulator evidence retains its identity; byte hashes remain globally deduplicated.
ALTER TABLE his_inbound_source ADD COLUMN source_id text NOT NULL DEFAULT 'SIMULATOR';
ALTER TABLE his_inbound_source DROP CONSTRAINT his_inbound_source_pkey;
ALTER TABLE his_inbound_source ADD PRIMARY KEY(source_id,source_path,sha256);
ALTER TABLE his_inbound_waiting ADD COLUMN source_id text NOT NULL DEFAULT 'SIMULATOR';
ALTER TABLE his_inbound_waiting DROP CONSTRAINT his_inbound_waiting_pkey;
ALTER TABLE his_inbound_waiting ADD PRIMARY KEY(source_id,source_path);
