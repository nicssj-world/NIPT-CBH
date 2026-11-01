-- Single-APP_ADMIN decision (owner 2026-11-01): the acting reviewer/certifier predicates also accept a current APP_ADMIN, as migration 161 does for the existing guards. Every evidence condition is unchanged.
-- Historical analytical evidence has its own authority. No QC, pooling, consent or clinical events are manufactured.
CREATE TABLE migration_result_review(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),version_id uuid NOT NULL REFERENCES result_report_version,
 record_id uuid NOT NULL REFERENCES migration_record,analysis_id uuid NOT NULL REFERENCES migration_analysis,
 source_sha256 text NOT NULL,report_sha256 text NOT NULL,record_row_version integer NOT NULL,
 case_id uuid NOT NULL REFERENCES nipt_case,round_id uuid NOT NULL REFERENCES specimen_round,attempt_id uuid NOT NULL REFERENCES analytical_attempt,
 reviewed_by uuid NOT NULL REFERENCES app_user,reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 identity_confirmed boolean NOT NULL CHECK(identity_confirmed),official_final_confirmed boolean NOT NULL CHECK(official_final_confirmed),disclosure_reviewed boolean NOT NULL CHECK(disclosure_reviewed),note text CHECK(length(note)<=500)
);
CREATE TRIGGER migration_result_review_immutable BEFORE UPDATE OR DELETE ON migration_result_review FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE FUNCTION migration_result_source_current(vid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM result_report_version v JOIN migration_record m ON m.case_id=v.case_id AND m.round_id=v.round_id AND m.attempt_id=v.attempt_id
 JOIN migration_analysis a ON a.record_id=m.id AND a.attempt_id=m.attempt_id JOIN migration_source s ON s.id=a.source_id
 JOIN analytical_attempt t ON t.id=v.attempt_id AND t.round_id=v.round_id AND t.case_id=v.case_id JOIN nipt_case c ON c.id=v.case_id
 JOIN p2_case_identity i ON i.case_id=v.case_id
 WHERE v.id=vid AND v.origin='EXTERNAL_READYGEN' AND v.kind='RESULT' AND c.registration_origin='LAB_DIRECT' AND c.current_round_id=v.round_id
 AND m.state='IMPORTED' AND a.sheet IN ('result','repeat')
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(m.exceptions) e WHERE e->>'severity'='REVIEW_BEFORE_RELEASE')
 AND EXISTS(SELECT 1 FROM migration_historical_run h WHERE h.run_label=a.run_label AND h.source_sha256=s.sha256)
 AND s.kind='HALOS_RUN' AND s.sha256 ~ '^[a-f0-9]{64}$' AND a.is_current AND a.classification='ANALYSIS' AND a.advice_status='QUALIFIED'
 AND a.attempt_number=t.attempt_number AND a.sample_raw=v.parsed#>>'{identifiers,labNumber,value}'
 AND ltrim(i.hn,'0')=ltrim(v.parsed#>>'{identifiers,hn,value}','0') AND nullif(i.hn,'') IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM specimen_round r WHERE r.id=v.round_id AND r.collection_date IS NOT NULL AND v.parsed#>>'{identifiers,collectionDate,value}' IS NOT NULL AND r.collection_date::text<>v.parsed#>>'{identifiers,collectionDate,value}')
 AND t.attempt_number=(SELECT max(x.attempt_number) FROM analytical_attempt x WHERE x.round_id=t.round_id)
 AND NOT COALESCE((SELECT e.event_type='HOLD_SET' FROM attempt_event e WHERE e.attempt_id=t.id AND e.event_type IN ('HOLD_SET','HOLD_RELEASED') ORDER BY e.sequence DESC LIMIT 1),false)
 AND v.parsed->>'templateKind' IN ('SINGLETON','TWIN') AND v.parsed#>>'{results,result,value}' IS DISTINCT FROM 'No Call'
 AND v.parsed#>>'{results,t21,value}' IN ('Low Risk','High Risk') AND v.parsed#>>'{results,t18,value}' IN ('Low Risk','High Risk') AND v.parsed#>>'{results,t13,value}' IN ('Low Risk','High Risk')
 AND CASE WHEN v.parsed->>'templateKind'='TWIN' THEN v.parsed#>>'{results,yChromosome,value}' IN ('Detected','Not Detected') ELSE
 v.parsed#>>'{results,qc,value}'='PASS' AND v.parsed#>>'{results,fetalFraction,value}' IS NOT NULL
 AND v.parsed#>>'{results,xo,value}' IN ('Detected','Not Detected') AND v.parsed#>>'{results,xxx,value}' IN ('Detected','Not Detected') AND v.parsed#>>'{results,xxy,value}' IN ('Detected','Not Detected') AND v.parsed#>>'{results,xyy,value}' IN ('Detected','Not Detected') END
 AND t.state NOT IN ('Superseded','BatchCancelled','Stopped','Cancelled','QcFailed')
 AND NOT EXISTS(SELECT 1 FROM repeat_work_order o WHERE o.round_id=v.round_id AND o.state IN ('RepeatRequested','RepeatPendingBatch','RepeatInProgress'))
 AND NOT EXISTS(SELECT 1 FROM his_intake_issue q WHERE q.case_id=v.case_id AND q.state IN ('Open','Proposed'))
 AND (SELECT count(*) FROM migration_analysis x WHERE x.record_id=m.id AND x.is_current AND x.classification='ANALYSIS')=1)
$$;
CREATE FUNCTION migration_result_review_current(vid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT migration_result_source_current(vid) AND EXISTS(SELECT 1 FROM migration_result_review r JOIN result_report_version v ON v.id=r.version_id
 JOIN migration_record m ON m.id=r.record_id JOIN migration_analysis a ON a.id=r.analysis_id JOIN migration_source s ON s.id=a.source_id
 JOIN app_user u ON u.id=r.reviewed_by
 WHERE v.id=vid AND r.report_sha256=v.sha256 AND r.source_sha256=s.sha256 AND r.record_row_version=m.row_version
 AND (r.case_id,r.round_id,r.attempt_id)=(v.case_id,v.round_id,v.attempt_id) AND m.id=a.record_id AND a.is_current AND r.attempt_id=a.attempt_id AND u.enabled
 AND r.reviewed_at>=COALESCE((SELECT max(e.created_at) FROM result_link_event e WHERE e.version_id=v.id),v.imported_at)
 AND EXISTS(SELECT 1 FROM role_assignment q WHERE q.user_id=u.id AND (q.role='APP_ADMIN' OR (q.role='LAB_CERTIFIER' AND q.approved_by IS NOT NULL)) AND q.effective_from<=now() AND(q.expires_at IS NULL OR q.expires_at>now())))
$$;
CREATE FUNCTION migration_result_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT nipt_operational_enabled() OR NOT migration_result_source_current(NEW.version_id) THEN RAISE EXCEPTION 'MIGRATION_CURRENT_SOURCE_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM result_report_version v JOIN migration_record m ON m.case_id=v.case_id AND m.round_id=v.round_id AND m.attempt_id=v.attempt_id JOIN migration_analysis a ON a.record_id=m.id JOIN migration_source s ON s.id=a.source_id
 WHERE v.id=NEW.version_id AND NEW.record_id=m.id AND NEW.analysis_id=a.id AND NEW.record_row_version=m.row_version AND NEW.report_sha256=v.sha256 AND NEW.source_sha256=s.sha256 AND (NEW.case_id,NEW.round_id,NEW.attempt_id)=(v.case_id,v.round_id,v.attempt_id))
 OR NOT EXISTS(SELECT 1 FROM app_user u JOIN role_assignment r ON r.user_id=u.id WHERE u.id=NEW.reviewed_by AND u.enabled AND (r.role='APP_ADMIN' OR (r.role='LAB_CERTIFIER' AND r.approved_by IS NOT NULL)) AND r.effective_from<=now() AND(r.expires_at IS NULL OR r.expires_at>now())) THEN RAISE EXCEPTION 'MIGRATION_REVIEW_BINDING_AUTHORITY_REQUIRED'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER migration_result_review_guard BEFORE INSERT ON migration_result_review FOR EACH ROW EXECUTE FUNCTION migration_result_review_guard();
DO $$ DECLARE d text; BEGIN
 SELECT pg_get_functiondef('p5_operational_release_guard()'::regprocedure) INTO d;
 d:=replace(d,'BEGIN',$body$BEGIN
 IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM migration_record m JOIN result_report_version v ON (v.case_id,v.round_id,v.attempt_id)=(m.case_id,m.round_id,m.attempt_id) WHERE v.id=NEW.version_id) AND NOT EXISTS(SELECT 1 FROM result_qc5_review q WHERE q.version_id=NEW.version_id AND task1_no_call_qc5_valid(q)) THEN
 IF NEW.synthetic OR NOT nipt_operational_enabled() OR NOT migration_result_review_current(NEW.version_id)
 OR NOT EXISTS(SELECT 1 FROM result_report_version v WHERE v.id=NEW.version_id AND v.state='CertifiedReleased' AND NOT v.synthetic AND (v.case_id,v.round_id)=(NEW.case_id,NEW.round_id))
 OR NOT EXISTS(SELECT 1 FROM result_gate_evaluation g WHERE g.version_id=NEW.version_id AND g.eligible AND g.outcome='CERTIFIED_RELEASED' AND g.actor_id=NEW.certified_by)
 OR NOT EXISTS(SELECT 1 FROM app_user u JOIN role_assignment a ON a.user_id=u.id WHERE u.id=NEW.certified_by AND u.enabled AND (a.role='APP_ADMIN' OR (a.role='LAB_CERTIFIER' AND a.approved_by IS NOT NULL)) AND a.effective_from<=now() AND(a.expires_at IS NULL OR a.expires_at>now()))
 OR EXISTS(SELECT 1 FROM p2_revocation WHERE case_id=NEW.case_id) THEN RAISE EXCEPTION 'MIGRATION_RELEASE_CURRENT_AUTHORITY_REQUIRED'; END IF;
 RETURN NEW; END IF;
 $body$); EXECUTE d;
 ALTER FUNCTION p6_release_eligible(uuid,integer) RENAME TO migration_normal_p6_release_eligible;
END $$;
CREATE FUNCTION p6_release_eligible(rid uuid,expected_epoch integer) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT CASE WHEN EXISTS(SELECT 1 FROM result_release r JOIN result_report_version v ON v.id=r.version_id JOIN migration_record m ON (m.case_id,m.round_id,m.attempt_id)=(v.case_id,v.round_id,v.attempt_id) WHERE r.id=rid) AND NOT EXISTS(SELECT 1 FROM result_release r JOIN result_qc5_review q ON q.version_id=r.version_id WHERE r.id=rid AND task1_no_call_qc5_valid(q)) THEN
 EXISTS(SELECT 1 FROM result_release r JOIN result_report_version v ON v.id=r.version_id JOIN app_user u ON u.id=r.certified_by WHERE r.id=rid AND r.epoch=expected_epoch AND r.state='Active' AND r.kind='RESULT' AND NOT r.synthetic AND v.state='CertifiedReleased' AND nipt_operational_enabled() AND migration_result_review_current(v.id) AND u.enabled
 AND EXISTS(SELECT 1 FROM role_assignment a WHERE a.user_id=u.id AND (a.role='APP_ADMIN' OR (a.role='LAB_CERTIFIER' AND a.approved_by IS NOT NULL)) AND a.effective_from<=now() AND(a.expires_at IS NULL OR a.expires_at>now())) AND NOT EXISTS(SELECT 1 FROM p2_revocation WHERE case_id=r.case_id))
 ELSE migration_normal_p6_release_eligible(rid,expected_epoch) END
$$;
REVOKE ALL ON migration_result_review FROM PUBLIC;
REVOKE ALL ON FUNCTION migration_result_source_current(uuid),migration_result_review_current(uuid),migration_normal_p6_release_eligible(uuid,integer),p6_release_eligible(uuid,integer) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_rw') THEN GRANT SELECT,INSERT ON migration_result_review TO app_rw; GRANT EXECUTE ON FUNCTION migration_result_source_current(uuid),migration_result_review_current(uuid) TO app_rw; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='worker_rw') THEN GRANT EXECUTE ON FUNCTION p6_release_eligible(uuid,integer) TO worker_rw; END IF;
END $$;
