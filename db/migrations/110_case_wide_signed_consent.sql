-- 110: A completed Digital Consent belongs to the patient/case, not to each
-- redraw or resampling round. Reuse immutable signed evidence for later rounds.
-- Never invent a new signature or modify an existing signed PDF.
CREATE OR REPLACE FUNCTION p2_clinical_source(target uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('roundId',r.id,'caseId',r.case_id,'currentRoundId',c.current_round_id,'workspaceVersion',w.version,'requestMode',w.request_mode,'consentMode',w.consent_mode,'draft',w.draft,
 'requestDocument',(SELECT to_jsonb(d) FROM p2_document_revision d WHERE d.round_id=r.id AND d.kind='REQUEST' ORDER BY d.version DESC LIMIT 1),
 'consentDocument',(SELECT to_jsonb(d) FROM p2_document_revision d WHERE d.round_id=r.id AND d.kind='CONSENT' ORDER BY d.version DESC LIMIT 1),
 'paperRequest',(SELECT to_jsonb(p) FROM p2_paper_review p WHERE p.round_id=r.id AND p.kind='REQUEST' ORDER BY p.created_at DESC,p.id DESC LIMIT 1),
 'paperConsent',(SELECT to_jsonb(p) FROM p2_paper_review p WHERE p.round_id=r.id AND p.kind='CONSENT' ORDER BY p.created_at DESC,p.id DESC LIMIT 1),
 'finalConsent',(SELECT to_jsonb(f) FROM p2_final_consent f JOIN p2_document_revision d ON d.id=f.document_id WHERE d.round_id=r.id ORDER BY d.version DESC LIMIT 1),
 'caseFinalConsent',(SELECT to_jsonb(f)||jsonb_build_object('round_id',d.round_id) FROM p2_final_consent f JOIN p2_document_revision d ON d.id=f.document_id WHERE d.case_id=r.case_id ORDER BY f.created_at DESC,f.id DESC LIMIT 1),
 'receipt',jsonb_build_object('source',r.received_source,'receivedAt',r.received_at,'collectionDate',r.collection_date),
 'collectionFacts',COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.sequence) FROM p2_collection_fact f WHERE f.round_id=r.id),'[]'::jsonb),
 'revoked',EXISTS(SELECT 1 FROM p2_revocation v WHERE v.case_id=r.case_id))
 FROM specimen_round r JOIN nipt_case c ON c.id=r.case_id JOIN p2_workspace w ON w.round_id=r.id WHERE r.id=target
$$;

-- The latest recorded decision considers the already-completed case-wide
-- digital document when a patient returns for blood redraw.
CREATE OR REPLACE FUNCTION p2_consent_latest_decision(target uuid) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT x.decision FROM (
  SELECT p.created_at,'Declined' AS decision FROM p2_paper_review p WHERE p.round_id=target AND p.kind='CONSENT' AND p.status='Declined'
  UNION ALL SELECT p.created_at,CASE WHEN p.panel->>'decision'='Granted' THEN 'Granted' ELSE 'Declined' END FROM p2_paper_review p WHERE p.round_id=target AND p.kind='CONSENT' AND p.status='Verified'
  UNION ALL SELECT f.created_at,CASE WHEN f.payload#>>'{signature,decision}'='Granted' THEN 'Granted' ELSE 'Declined' END
   FROM p2_final_consent f JOIN p2_document_revision d ON d.id=f.document_id
   JOIN specimen_round r ON r.case_id=d.case_id WHERE r.id=target
 ) x ORDER BY x.created_at DESC,x.decision ASC LIMIT 1
$$;

CREATE OR REPLACE FUNCTION p2_clinical_documents_ready(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT COALESCE((SELECT
  x->>'currentRoundId'=target::text AND x->>'revoked'='false'
  AND (CASE WHEN x->>'requestMode'='Electronic' THEN x#>'{requestDocument,payload,draft}'=x->'draft' ELSE x#>>'{paperRequest,status}'='Verified' END)
  AND (CASE WHEN x->>'consentMode'='Electronic' THEN CASE
    WHEN x#>>'{caseFinalConsent,payload,signature,decision}'='Granted'
     AND x#>>'{caseFinalConsent,round_id}' IS NOT NULL
     AND x#>>'{caseFinalConsent,round_id}'<>target::text THEN true
    ELSE x#>>'{finalConsent,document_id}'=x#>>'{consentDocument,id}'
     AND x#>>'{finalConsent,payload,signature,decision}'='Granted'
     AND x#>'{consentDocument,payload,workspaceVersion}'=x->'workspaceVersion'
   END ELSE x->>'consentMode'='Paper' END)
  AND COALESCE(p2_consent_latest_decision(target),'')<>'Declined'
  FROM (SELECT p2_clinical_source(target) x) source),false)
 AND (SELECT count(DISTINCT collection_date)=1 FROM (
  SELECT collection_date FROM (SELECT DISTINCT ON(source) collection_date FROM p2_collection_fact WHERE round_id=target ORDER BY source,sequence DESC) latest
  UNION ALL SELECT collection_date FROM specimen_round WHERE id=target AND received_source='HIS_PET_RECEIPT' AND collection_date IS NOT NULL
 ) dates)
$$;

-- Serialize patient completion at case scope even if two devices prepared
-- separate Consent revisions before either signature was submitted.
CREATE FUNCTION p2_one_signed_consent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_case uuid;
BEGIN
 SELECT d.case_id INTO owner_case FROM p2_document_revision d WHERE d.id=NEW.document_id;
 IF owner_case IS NULL THEN RAISE EXCEPTION 'CONSENT_DOCUMENT_NOT_FOUND'; END IF;
 PERFORM id FROM nipt_case WHERE id=owner_case FOR UPDATE;
 IF EXISTS(
  SELECT 1 FROM p2_final_consent f
  JOIN p2_document_revision d ON d.id=f.document_id
  WHERE d.case_id=owner_case
 ) THEN RAISE EXCEPTION 'CONSENT_ALREADY_COMPLETED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER p2_one_signed_consent_guard
 BEFORE INSERT ON p2_final_consent FOR EACH ROW
 EXECUTE FUNCTION p2_one_signed_consent_guard();
