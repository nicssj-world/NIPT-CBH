-- Owner correction 2026-10-18 "SIMPLIFY PAPER CONSENT", approved by the Owner 2026-10-18 (forward only, isolated synthetic
-- databases only; 088 is not edited). Paper Consent is a channel marker recorded by ANC (p2_workspace.consent_mode='Paper').
-- It says only that this round uses the paper form; it is not evidence that the patient signed. The round no longer waits for a
-- paper consent review in the system. A recorded refusal (paper review Declined, a verified review whose decision is not
-- Granted, or an electronic Declined signature) and a withdrawal still stop the round. Request readiness and the Electronic
-- Consent branch are unchanged.
CREATE OR REPLACE FUNCTION p2_clinical_documents_ready(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT COALESCE((SELECT
  x->>'currentRoundId'=target::text AND x->>'revoked'='false'
  AND (CASE WHEN x->>'requestMode'='Electronic' THEN x#>'{requestDocument,payload,draft}'=x->'draft' ELSE x#>>'{paperRequest,status}'='Verified' END)
  AND (CASE WHEN x->>'consentMode'='Electronic' THEN x#>>'{finalConsent,document_id}'=x#>>'{consentDocument,id}' AND x#>>'{finalConsent,payload,signature,decision}'='Granted' AND x#>'{consentDocument,payload,workspaceVersion}'=x->'workspaceVersion'
       ELSE x->>'consentMode'='Paper'
        AND COALESCE(x#>>'{paperConsent,status}','')<>'Declined'
        AND NOT (COALESCE(x#>>'{paperConsent,status}','')='Verified' AND x#>>'{paperConsent,panel,decision}' IS DISTINCT FROM 'Granted')
        AND COALESCE(x#>>'{finalConsent,payload,signature,decision}','')<>'Declined' END)
  FROM (SELECT p2_clinical_source(target) x) source),false)
 AND (SELECT count(DISTINCT collection_date)=1 FROM (
  SELECT collection_date FROM (SELECT DISTINCT ON(source) collection_date FROM p2_collection_fact WHERE round_id=target ORDER BY source,sequence DESC) latest
  UNION ALL SELECT collection_date FROM specimen_round WHERE id=target AND received_source='HIS_PET_RECEIPT' AND collection_date IS NOT NULL
 ) dates)
$$;
