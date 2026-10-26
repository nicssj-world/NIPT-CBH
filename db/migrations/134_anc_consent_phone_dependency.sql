-- Owner 2026-10-25: a proven coordinator-phone-only change does not require
-- another patient signature. Never change the signed revision or its evidence.
-- Every other difference retains the existing version dependency.
CREATE FUNCTION p2_consent_workspace_matches(signed_payload jsonb,current_draft jsonb,current_version integer)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT COALESCE(
  signed_payload->'workspaceVersion'=to_jsonb(current_version)
  OR (
   jsonb_typeof(signed_payload->'workspaceVersion')='number'
   AND signed_payload->'workspaceVersion'<to_jsonb(current_version)
   AND jsonb_typeof(signed_payload->'requestDraft')='object'
   AND jsonb_typeof(current_draft)='object'
   AND jsonb_typeof(signed_payload#>'{requestDraft,ordering,phone}') IN ('string','null')
   AND jsonb_typeof(current_draft#>'{ordering,phone}') IN ('string','null')
   AND signed_payload#>'{requestDraft,ordering,phone}' IS DISTINCT FROM current_draft#>'{ordering,phone}'
   AND (signed_payload->'requestDraft') #- '{ordering,phone}' = current_draft #- '{ordering,phone}'
  ),false)
$$;

-- Keep all original Request, decision, revocation, collection and prior-round gates.
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
     AND p2_consent_workspace_matches(x#>'{consentDocument,payload}',x->'draft',(x->>'workspaceVersion')::integer)
   END ELSE x->>'consentMode'='Paper' END)
  AND COALESCE(p2_consent_latest_decision(target),'')<>'Declined'
  FROM (SELECT p2_clinical_source(target) x) source),false)
 AND (SELECT count(DISTINCT collection_date)=1 FROM (
  SELECT collection_date FROM (SELECT DISTINCT ON(source) collection_date FROM p2_collection_fact WHERE round_id=target ORDER BY source,sequence DESC) latest
  UNION ALL SELECT collection_date FROM specimen_round WHERE id=target AND received_source='HIS_PET_RECEIPT' AND collection_date IS NOT NULL
 ) dates)
$$;
