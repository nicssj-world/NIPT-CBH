-- P2 operational documents and evidence-bound human clinical assessment.
ALTER TABLE p2_document_revision DROP CONSTRAINT p2_document_revision_template_version_check;
ALTER TABLE p2_document_revision ADD CONSTRAINT p2_document_template_contract CHECK(template_version IN ('SYNTHETIC-FM01-v1','SYNTHETIC-FM02-v1','CBH-FM01-v1','CBH-FM02-v1'));
ALTER TABLE p2_paper_review DROP CONSTRAINT p2_paper_review_template_version_check;
ALTER TABLE p2_paper_review ADD CONSTRAINT p2_paper_template_contract CHECK(template_version IN ('SYNTHETIC-FM01-v1','SYNTHETIC-FM02-v1','CBH-FM01-v1','CBH-FM02-v1'));
ALTER TABLE clinical_snapshot ADD COLUMN review_sequence bigint GENERATED ALWAYS AS IDENTITY;
CREATE FUNCTION p2_clinical_source(target uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('roundId',r.id,'caseId',r.case_id,'currentRoundId',c.current_round_id,'workspaceVersion',w.version,'requestMode',w.request_mode,'consentMode',w.consent_mode,'draft',w.draft,
 'requestDocument',(SELECT to_jsonb(d) FROM p2_document_revision d WHERE d.round_id=r.id AND d.kind='REQUEST' ORDER BY d.version DESC LIMIT 1),
 'consentDocument',(SELECT to_jsonb(d) FROM p2_document_revision d WHERE d.round_id=r.id AND d.kind='CONSENT' ORDER BY d.version DESC LIMIT 1),
 'paperRequest',(SELECT to_jsonb(p) FROM p2_paper_review p WHERE p.round_id=r.id AND p.kind='REQUEST' ORDER BY p.created_at DESC,p.id DESC LIMIT 1),
 'paperConsent',(SELECT to_jsonb(p) FROM p2_paper_review p WHERE p.round_id=r.id AND p.kind='CONSENT' ORDER BY p.created_at DESC,p.id DESC LIMIT 1),
 'finalConsent',(SELECT to_jsonb(f) FROM p2_final_consent f JOIN p2_document_revision d ON d.id=f.document_id WHERE d.round_id=r.id ORDER BY d.version DESC LIMIT 1),
 'receipt',jsonb_build_object('source',r.received_source,'receivedAt',r.received_at,'collectionDate',r.collection_date),
 'collectionFacts',COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.sequence) FROM p2_collection_fact f WHERE f.round_id=r.id),'[]'::jsonb),
 'revoked',EXISTS(SELECT 1 FROM p2_revocation v WHERE v.case_id=r.case_id))
 FROM specimen_round r JOIN nipt_case c ON c.id=r.case_id JOIN p2_workspace w ON w.round_id=r.id WHERE r.id=target
$$;
CREATE FUNCTION p2_clinical_source_hash(target uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT encode(sha256(convert_to(p2_canonical_jsonb(p2_clinical_source(target)),'UTF8')),'hex') $$;
CREATE FUNCTION p2_clinical_documents_ready(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT COALESCE((SELECT
  x->>'currentRoundId'=target::text AND x->>'revoked'='false'
  AND (CASE WHEN x->>'requestMode'='Electronic' THEN x#>'{requestDocument,payload,draft}'=x->'draft' ELSE x#>>'{paperRequest,status}'='Verified' END)
  AND (CASE WHEN x->>'consentMode'='Electronic' THEN x#>>'{finalConsent,document_id}'=x#>>'{consentDocument,id}' AND x#>>'{finalConsent,payload,signature,decision}'='Granted' AND x#>'{consentDocument,payload,workspaceVersion}'=x->'workspaceVersion'
       ELSE x#>>'{paperConsent,status}'='Verified' AND x#>>'{paperConsent,panel,decision}'='Granted' END)
  FROM (SELECT p2_clinical_source(target) x) source),false)
 AND (SELECT count(DISTINCT collection_date)=1 FROM (
  SELECT collection_date FROM (SELECT DISTINCT ON(source) collection_date FROM p2_collection_fact WHERE round_id=target ORDER BY source,sequence DESC) latest
  UNION ALL SELECT collection_date FROM specimen_round WHERE id=target AND received_source='HIS_PET_RECEIPT' AND collection_date IS NOT NULL
 ) dates)
$$;
CREATE FUNCTION p2_clinical_ready(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT nipt_operational_enabled() AND p2_clinical_documents_ready(target) AND COALESCE((SELECT s.rule_version='CBH-AUTHORIZED-REVIEW-v1' AND s.result->>'state'='ClinicalPassed' AND s.result->>'passed'='true' AND s.result->>'sourceHash'=p2_clinical_source_hash(target) FROM clinical_snapshot s WHERE s.round_id=target ORDER BY s.review_sequence DESC LIMIT 1),false)
$$;
CREATE FUNCTION p2_clinical_positive_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.result->>'passed'='true' OR NEW.result->>'state'='ClinicalPassed' THEN
  IF NOT nipt_operational_enabled() OR NOT p2_clinical_documents_ready(NEW.round_id) OR NEW.rule_version<>'CBH-AUTHORIZED-REVIEW-v1' OR NEW.result->>'authority'<>'AUTHORIZED_CLINICAL_REVIEW'
   OR NEW.result->>'sourceHash' IS DISTINCT FROM p2_clinical_source_hash(NEW.round_id)
   OR NEW.input_snapshot IS DISTINCT FROM p2_clinical_source(NEW.round_id)
   OR NOT EXISTS(SELECT 1 FROM role_assignment a JOIN app_user u ON u.id=a.user_id WHERE a.user_id::text=NEW.result->>'reviewerId' AND a.role='CLINICAL_APPROVER' AND u.enabled AND a.effective_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now()))
  THEN RAISE EXCEPTION 'AUTHORIZED_CURRENT_CLINICAL_REVIEW_REQUIRED'; END IF;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER p2_clinical_positive_guard BEFORE INSERT ON clinical_snapshot FOR EACH ROW EXECUTE FUNCTION p2_clinical_positive_guard();
