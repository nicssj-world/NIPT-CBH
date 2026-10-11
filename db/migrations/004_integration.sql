ALTER TABLE his_inbound_file ADD COLUMN filename text, ADD COLUMN parsed jsonb;
CREATE UNIQUE INDEX inbound_content_hash ON his_inbound_file(sha256);
CREATE TABLE integration_job_receipt(outbox_id uuid PRIMARY KEY REFERENCES job_outbox,result jsonb NOT NULL DEFAULT '{}',completed_at timestamptz NOT NULL DEFAULT now());
