-- Forward-only review correction. Refuse ambiguous existing evidence instead of selecting/deleting a winner.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM p2_signing_session WHERE state='Active' GROUP BY document_id HAVING count(*)>1)
 OR EXISTS(SELECT 1 FROM p2_consent_signature GROUP BY document_id HAVING count(*)>1)
 OR EXISTS(SELECT 1 FROM p2_final_consent GROUP BY document_id HAVING count(*)>1)
 THEN RAISE EXCEPTION 'AMBIGUOUS_CONSENT_EVIDENCE_REQUIRES_GOVERNANCE'; END IF;
END $$;
CREATE UNIQUE INDEX p2_one_active_signer_per_document ON p2_signing_session(document_id) WHERE state='Active';
ALTER TABLE p2_consent_signature ADD CONSTRAINT p2_one_signature_per_document UNIQUE(document_id);
ALTER TABLE p2_final_consent ADD CONSTRAINT p2_one_final_consent_per_document UNIQUE(document_id);
ALTER TABLE p2_final_consent ADD COLUMN hash_algorithm text NOT NULL DEFAULT 'JS_CANONICAL_V1' CHECK(hash_algorithm IN ('JS_CANONICAL_V1','PG_JSONB_CANONICAL_V1'));
CREATE FUNCTION p2_canonical_jsonb(input jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE result text; BEGIN
 CASE jsonb_typeof(input)
 WHEN 'object' THEN SELECT '{'||coalesce(string_agg(to_jsonb(key)::text||':'||p2_canonical_jsonb(value),',' ORDER BY key COLLATE "C"),'')||'}' INTO result FROM jsonb_each(input);
 WHEN 'array' THEN SELECT '['||coalesce(string_agg(p2_canonical_jsonb(value),',' ORDER BY ordinality),'')||']' INTO result FROM jsonb_array_elements(input) WITH ORDINALITY;
 ELSE result:=input::text;
 END CASE;
 RETURN result;
END $$;
CREATE FUNCTION p2_signing_document_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.document_id::text,75432804));
 IF NEW.state='Active' AND EXISTS(SELECT 1 FROM p2_consent_signature WHERE document_id=NEW.document_id) THEN RAISE EXCEPTION 'CONSENT_ALREADY_SIGNED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM p2_document_revision WHERE id=NEW.document_id AND kind='CONSENT') THEN RAISE EXCEPTION 'CONSENT_DOCUMENT_REQUIRED'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER p2_signing_document_guard BEFORE INSERT ON p2_signing_session FOR EACH ROW EXECUTE FUNCTION p2_signing_document_guard();
-- Exact source binding and current-state check at finalization; a completed signature alone cannot reopen a gate.
CREATE OR REPLACE FUNCTION p2_final_consent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s p2_signing_session; p p2_consent_signature; d p2_document_revision; a jsonb; BEGIN
 SELECT * INTO s FROM p2_signing_session WHERE id=NEW.session_id;
 SELECT * INTO p FROM p2_consent_signature WHERE session_id=s.id;
 SELECT * INTO d FROM p2_document_revision WHERE id=NEW.document_id;
 IF s.reauthenticated_at IS NULL OR NEW.payload->'session'->'attestation' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'PREPARER_ATTESTATION_REQUIRED'; END IF;
 PERFORM id FROM nipt_case WHERE id=s.case_id FOR UPDATE;
 IF s.id IS NULL OR p.id IS NULL OR d.id IS NULL OR s.document_id IS DISTINCT FROM NEW.document_id
 OR s.state IS DISTINCT FROM 'Completed' OR s.reauthenticated_at IS NULL OR d.kind IS DISTINCT FROM 'CONSENT'
 OR NOT EXISTS(SELECT 1 FROM nipt_case c JOIN p2_workspace w ON w.round_id=c.current_round_id
 WHERE c.id=s.case_id AND c.current_round_id=s.round_id AND w.consent_mode='Electronic' AND w.version::text=d.payload->>'workspaceVersion'
 AND d.version=(SELECT max(version) FROM p2_document_revision WHERE round_id=s.round_id AND kind='CONSENT'))
 OR EXISTS(SELECT 1 FROM p2_revocation WHERE case_id=s.case_id)
 THEN RAISE EXCEPTION 'CONSENT_FINALIZATION_INVALIDATED'; END IF;
 IF NEW.payload->'session'->'attestation' IS DISTINCT FROM 'true'::jsonb
 OR NEW.payload->'session'->>'id' IS DISTINCT FROM s.id::text
 OR NEW.payload->'session'->>'preparerId' IS DISTINCT FROM s.preparer_id::text
 OR (NEW.payload->'session'->>'startedAt')::timestamptz IS DISTINCT FROM s.created_at
 OR (NEW.payload->'session'->>'closedAt')::timestamptz IS DISTINCT FROM s.closed_at
 OR (NEW.payload->'session'->>'attestedAt')::timestamptz IS DISTINCT FROM s.reauthenticated_at
 OR NEW.payload->'document' IS DISTINCT FROM d.payload OR NEW.payload->>'templateVersion' IS DISTINCT FROM d.template_version
 OR NEW.payload->>'preparedHash' IS DISTINCT FROM d.content_hash OR NEW.payload->'synthetic' IS DISTINCT FROM 'true'::jsonb
 OR NEW.payload->'signature'->>'decision' IS DISTINCT FROM p.decision
 OR NEW.payload->'signature'->>'signature_hash' IS DISTINCT FROM p.signature_hash
 OR NEW.payload->'signature'->'vector' IS DISTINCT FROM p.vector OR NEW.payload->'signature'->>'png' IS DISTINCT FROM p.png
 OR (NEW.payload->'signature'->>'signed_at')::timestamptz IS DISTINCT FROM p.signed_at
 OR jsonb_typeof(NEW.payload->'acknowledgments') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'PREPARER_ATTESTATION_REQUIRED'; END IF;
 IF jsonb_array_length(NEW.payload->'acknowledgments')<>12
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.payload->'acknowledgments') WITH ORDINALITY a(value,n) WHERE (value->>'item')::integer IS DISTINCT FROM n::integer)
 OR (SELECT count(DISTINCT (v->>'item')::integer) FROM jsonb_array_elements(NEW.payload->'acknowledgments') v)<>12
 THEN RAISE EXCEPTION 'ACKNOWLEDGMENT_EVIDENCE_MISMATCH'; END IF;
 FOR a IN SELECT value FROM jsonb_array_elements(NEW.payload->'acknowledgments') LOOP
 IF NOT EXISTS(SELECT 1 FROM p2_consent_ack WHERE session_id=s.id AND to_jsonb(item)=a->'item' AND acknowledged_at=(a->>'acknowledged_at')::timestamptz)
 THEN RAISE EXCEPTION 'ACKNOWLEDGMENT_EVIDENCE_MISMATCH'; END IF;
 END LOOP;
 IF NEW.hash_algorithm IS DISTINCT FROM 'PG_JSONB_CANONICAL_V1'
 OR NEW.content_hash IS DISTINCT FROM encode(sha256(convert_to(p2_canonical_jsonb(NEW.payload),'UTF8')),'hex')
 THEN RAISE EXCEPTION 'FINAL_CONSENT_HASH_MISMATCH'; END IF;
 RETURN NEW;
END $$;
