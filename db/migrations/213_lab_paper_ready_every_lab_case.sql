-- Owner 2026-11-10 (after the 2026-11-09 decision that Lab registration is paper 100%): a Lab-registered case is ready on the paper path
-- without needing (a) a lab_operational_registration row with the paper flags or (b) the absence of any clinical_snapshot. A case created by an
-- older route or one that merely had its clinical data evaluated was refused for exactly those two reasons although its request form and consent
-- are the paper ones. What still holds a Lab case: not the current round, a recorded withdrawal (p2_revocation), a declined consent decision
-- (a recorded paper refusal stays a gate) and an open HIS intake issue. Same function name and signature; CREATE OR REPLACE keeps its grants.
CREATE OR REPLACE FUNCTION lab_owner_paper_ready(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM specimen_round r JOIN nipt_case c ON c.id=r.case_id WHERE r.id=target AND c.current_round_id=r.id AND c.registration_origin='LAB_DIRECT'
 AND NOT EXISTS(SELECT 1 FROM p2_revocation v WHERE v.case_id=c.id)
 AND p2_consent_latest_decision(r.id) IS DISTINCT FROM 'Declined'
 AND NOT EXISTS(SELECT 1 FROM his_intake_issue i WHERE i.case_id=c.id AND i.state IN ('Open','Proposed')))
$$;
