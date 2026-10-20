-- A completed patient signing session is the authorization to finalize Consent.
-- Keep staff access suspended; returning to the staff workspace still requires a normal login.
CREATE OR REPLACE FUNCTION p2_final_consent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s p2_signing_session; p p2_consent_signature; d p2_document_revision; a jsonb; BEGIN
 SELECT * INTO s FROM p2_signing_session WHERE id=NEW.session_id;
 SELECT * INTO p FROM p2_consent_signature WHERE session_id=s.id;
 SELECT * INTO d FROM p2_document_revision WHERE id=NEW.document_id;
 PERFORM id FROM nipt_case WHERE id=s.case_id FOR UPDATE;
 IF s.id IS NULL OR p.id IS NULL OR d.id IS NULL OR s.document_id IS DISTINCT FROM NEW.document_id
 OR s.state IS DISTINCT FROM 'Completed' OR s.closed_at IS NULL OR d.kind IS DISTINCT FROM 'CONSENT'
 OR NOT EXISTS(SELECT 1 FROM nipt_case c JOIN p2_workspace w ON w.round_id=c.current_round_id
 WHERE c.id=s.case_id AND c.current_round_id=s.round_id AND w.consent_mode='Electronic' AND w.version::text=d.payload->>'workspaceVersion'
 AND d.version=(SELECT max(version) FROM p2_document_revision WHERE round_id=s.round_id AND kind='CONSENT'))
 OR EXISTS(SELECT 1 FROM p2_revocation WHERE case_id=s.case_id)
 THEN RAISE EXCEPTION 'CONSENT_FINALIZATION_INVALIDATED'; END IF;
 IF NEW.payload->'session'->>'finalization' IS DISTINCT FROM 'PATIENT_COMPLETED' THEN RAISE EXCEPTION 'PATIENT_FINALIZATION_MARKER_MISMATCH'; END IF;
 IF NEW.payload->'session'->>'id' IS DISTINCT FROM s.id::text THEN RAISE EXCEPTION 'PATIENT_FINALIZATION_SESSION_ID_MISMATCH'; END IF;
 IF NEW.payload->'session'->>'preparerId' IS DISTINCT FROM s.preparer_id::text THEN RAISE EXCEPTION 'PATIENT_FINALIZATION_PREPARER_MISMATCH'; END IF;
 IF (NEW.payload->'session'->>'startedAt')::timestamptz IS DISTINCT FROM s.created_at THEN RAISE EXCEPTION 'PATIENT_FINALIZATION_START_TIME_MISMATCH'; END IF;
 IF (NEW.payload->'session'->>'completedAt')::timestamptz IS DISTINCT FROM s.closed_at THEN RAISE EXCEPTION 'PATIENT_FINALIZATION_COMPLETION_TIME_MISMATCH'; END IF;
 IF NEW.payload->'document' IS DISTINCT FROM d.payload OR NEW.payload->>'templateVersion' IS DISTINCT FROM d.template_version
 OR NEW.payload->>'preparedHash' IS DISTINCT FROM d.content_hash
 THEN RAISE EXCEPTION 'PATIENT_FINALIZATION_DOCUMENT_EVIDENCE_MISMATCH'; END IF;
 IF NEW.payload->'synthetic' IS DISTINCT FROM to_jsonb(NOT nipt_operational_enabled())
 THEN RAISE EXCEPTION 'PATIENT_FINALIZATION_MODE_MISMATCH'; END IF;
 IF NEW.payload->'signature'->>'decision' IS DISTINCT FROM p.decision
 OR NEW.payload->'signature'->>'signature_hash' IS DISTINCT FROM p.signature_hash
 OR NEW.payload->'signature'->'vector' IS DISTINCT FROM p.vector OR NEW.payload->'signature'->>'png' IS DISTINCT FROM p.png
 OR (NEW.payload->'signature'->>'signed_at')::timestamptz IS DISTINCT FROM p.signed_at
 THEN RAISE EXCEPTION 'PATIENT_FINALIZATION_SIGNATURE_EVIDENCE_MISMATCH'; END IF;
 IF jsonb_typeof(NEW.payload->'acknowledgments') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'PATIENT_FINALIZATION_ACKNOWLEDGMENTS_MISSING'; END IF;
 IF jsonb_array_length(NEW.payload->'acknowledgments')<>12
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.payload->'acknowledgments') WITH ORDINALITY a(value,n) WHERE (value->>'item')::integer IS DISTINCT FROM n::integer)
 OR (SELECT count(DISTINCT (v->>'item')::integer) FROM jsonb_array_elements(NEW.payload->'acknowledgments') v)<>12
 THEN RAISE EXCEPTION 'ACKNOWLEDGMENT_EVIDENCE_MISMATCH'; END IF;
 FOR a IN SELECT value FROM jsonb_array_elements(NEW.payload->'acknowledgments') LOOP
  IF NOT EXISTS(SELECT 1 FROM p2_consent_ack WHERE session_id=s.id AND to_jsonb(item)=a->'item' AND acknowledged_at=(a->>'acknowledged_at')::timestamptz)
  THEN RAISE EXCEPTION 'ACKNOWLEDGMENT_EVIDENCE_MISMATCH'; END IF;
 END LOOP;
 IF nipt_operational_enabled() THEN
  IF d.payload#>>'{consentContent,id}' IS DISTINCT FROM 'CBH-BM17-CONSENT-2026-10-18-v1'
  OR d.payload#>>'{consentContent,sha256}' IS DISTINCT FROM '3ce51b081f61caf1ad99f60acffd3c7dbd9a196e62906bd0e8689c5cf7ad3c5d'
  OR encode(sha256(convert_to(p2_canonical_jsonb((d.payload->'consentContent')-'sha256'),'UTF8')),'hex') IS DISTINCT FROM d.payload#>>'{consentContent,sha256}'
  OR NEW.payload->'consentContent' IS DISTINCT FROM d.payload->'consentContent'
  OR d.payload->'synthetic' IS DISTINCT FROM 'false'::jsonb
  THEN RAISE EXCEPTION 'CONSENT_CONTENT_VERSION_MISMATCH'; END IF;
  FOR a IN SELECT value FROM jsonb_array_elements(NEW.payload->'acknowledgments') LOOP
   IF a->>'contentVersion' IS DISTINCT FROM d.payload#>>'{consentContent,id}'
   OR a->>'contentSha256' IS DISTINCT FROM d.payload#>>'{consentContent,sha256}'
   OR a->>'clauseId' IS DISTINCT FROM (d.payload#>'{consentContent,clauses}')->((a->>'item')::int-1)->>'id'
   THEN RAISE EXCEPTION 'ACKNOWLEDGMENT_CONTENT_VERSION_MISMATCH'; END IF;
  END LOOP;
 END IF;
 IF NEW.hash_algorithm IS DISTINCT FROM 'PG_JSONB_CANONICAL_V1'
 OR NEW.content_hash IS DISTINCT FROM encode(sha256(convert_to(p2_canonical_jsonb(NEW.payload),'UTF8')),'hex')
 THEN RAISE EXCEPTION 'FINAL_CONSENT_HASH_MISMATCH'; END IF;
 RETURN NEW;
END $$;
