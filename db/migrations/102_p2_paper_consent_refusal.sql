-- Owner decision 2026-10-18 "Final Consent Owner Decisions": a Paper Consent refusal recorded by ANC is a real refusal.
-- Forward only, isolated synthetic databases only; 088 and 101 are not edited.
-- The Paper Consent marker (p2_workspace.consent_mode='Paper', migration 101) still proceeds without any paper step, but it can never
-- hide a recorded refusal. The latest DECISIVE consent evidence of the round decides: a paper review (Verified = granted, Declined =
-- refused) or an electronic final consent (signature decision). Pending/Replaced/Amended paper rows and the marker are not decisive,
-- so selecting Paper again, or a later non-decisive paper row, cannot overwrite a refusal. Only a later decisive Granted decision
-- (a verified paper review or a completed Granted signature) lifts it. Withdrawal (p2_revocation) is a separate rule and is unchanged.
CREATE FUNCTION p2_consent_latest_decision(target uuid) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT x.decision FROM (
  SELECT p.created_at,'Declined' AS decision FROM p2_paper_review p WHERE p.round_id=target AND p.kind='CONSENT' AND p.status='Declined'
  UNION ALL SELECT p.created_at,CASE WHEN p.panel->>'decision'='Granted' THEN 'Granted' ELSE 'Declined' END FROM p2_paper_review p WHERE p.round_id=target AND p.kind='CONSENT' AND p.status='Verified' -- Verified counts as granted only when its panel decision is Granted
  UNION ALL SELECT f.created_at,CASE WHEN f.payload#>>'{signature,decision}'='Granted' THEN 'Granted' ELSE 'Declined' END
   FROM p2_final_consent f JOIN p2_document_revision d ON d.id=f.document_id WHERE d.round_id=target
 ) x ORDER BY x.created_at DESC, x.decision ASC LIMIT 1 -- a tie resolves to Declined
$$;
CREATE OR REPLACE FUNCTION p2_clinical_documents_ready(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT COALESCE((SELECT
  x->>'currentRoundId'=target::text AND x->>'revoked'='false'
  AND (CASE WHEN x->>'requestMode'='Electronic' THEN x#>'{requestDocument,payload,draft}'=x->'draft' ELSE x#>>'{paperRequest,status}'='Verified' END)
  AND (CASE WHEN x->>'consentMode'='Electronic' THEN x#>>'{finalConsent,document_id}'=x#>>'{consentDocument,id}' AND x#>>'{finalConsent,payload,signature,decision}'='Granted' AND x#>'{consentDocument,payload,workspaceVersion}'=x->'workspaceVersion'
       ELSE x->>'consentMode'='Paper' END)
  AND COALESCE(p2_consent_latest_decision(target),'')<>'Declined'
  FROM (SELECT p2_clinical_source(target) x) source),false)
 AND (SELECT count(DISTINCT collection_date)=1 FROM (
  SELECT collection_date FROM (SELECT DISTINCT ON(source) collection_date FROM p2_collection_fact WHERE round_id=target ORDER BY source,sequence DESC) latest
  UNION ALL SELECT collection_date FROM specimen_round WHERE id=target AND received_source='HIS_PET_RECEIPT' AND collection_date IS NOT NULL
 ) dates)
$$;
