-- Optional, private photographic evidence for a specimen rejection.
-- Kept in PostgreSQL; never exposed as a public file path or filename.
CREATE TABLE specimen_rejection_evidence(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 acceptance_id uuid NOT NULL REFERENCES specimen_acceptance(id),
 sequence smallint NOT NULL CHECK(sequence BETWEEN 1 AND 4),
 media_type text NOT NULL CHECK(media_type IN ('image/jpeg','image/png','image/webp')),
 content bytea NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 1048576),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 actor_id uuid NOT NULL REFERENCES app_user(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(acceptance_id,sequence)
);
CREATE INDEX specimen_rejection_evidence_acceptance ON specimen_rejection_evidence(acceptance_id,sequence);
CREATE TRIGGER specimen_rejection_evidence_immutable
 BEFORE UPDATE OR DELETE ON specimen_rejection_evidence
 FOR EACH ROW EXECUTE FUNCTION immutable_row();
