-- SQL-bound currentness stamp for F5 preview. Immutable evidence IDs change on
-- correction, review, new transfer/run or lifecycle progress, including raw INSERT.
CREATE FUNCTION p4c_evidence_token(did uuid) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object(
 'dnb',did,
 'events',(SELECT jsonb_agg(id ORDER BY sequence) FROM p4c_dnb_event WHERE dnb_id=did AND event_type NOT IN ('PREVIEW','PRE_WORK','COMPLETED','RECALL')),
 'observations',(SELECT jsonb_agg(id ORDER BY sequence) FROM p4c_dnb_observation WHERE dnb_id=did),
 'reviews',(SELECT jsonb_agg(r.id ORDER BY r.id) FROM p4c_dnb_review r JOIN p4c_dnb_observation o ON o.id=r.observation_id WHERE o.dnb_id=did),
 'decisions',(SELECT jsonb_agg(id ORDER BY sequence) FROM p4c_qc3_decision WHERE dnb_id=did),
 'handoffs',(SELECT jsonb_agg(id ORDER BY revision) FROM p4c_handoff WHERE dnb_id=did),
 'transfers',(SELECT jsonb_agg(t.id ORDER BY t.sequence) FROM p4c_handoff_transfer t JOIN p4c_handoff h ON h.id=t.handoff_id WHERE h.dnb_id=did),
 'verifications',(SELECT jsonb_agg(v.id ORDER BY v.id) FROM p4c_handoff_verification v JOIN p4c_handoff_transfer t ON t.id=v.transfer_id JOIN p4c_handoff h ON h.id=t.handoff_id WHERE h.dnb_id=did),
 'runs',(SELECT jsonb_agg(id ORDER BY attempt_number) FROM p4c_sequencing_attempt WHERE dnb_id=did),
 'qc4',(SELECT jsonb_agg(o.id ORDER BY o.sequence) FROM p4c_qc4_observation o JOIN p4c_sequencing_attempt s ON s.id=o.sequencing_id WHERE s.dnb_id=did),
 'qc4reviews',(SELECT jsonb_agg(r.id ORDER BY r.id) FROM p4c_qc4_review r JOIN p4c_qc4_observation o ON o.id=r.qc4_id JOIN p4c_sequencing_attempt s ON s.id=o.sequencing_id WHERE s.dnb_id=did)
 )::text,'UTF8')),'hex');
$$;
CREATE FUNCTION p4c_preview_stamp() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.event_type='PREVIEW' THEN
 PERFORM b.id FROM lab_batch b JOIN p4c_dnb_attempt d ON d.batch_id=b.id WHERE d.id=NEW.dnb_id FOR UPDATE OF b;
 NEW.payload:=NEW.payload||jsonb_build_object('databaseEvidenceToken',p4c_evidence_token(NEW.dnb_id));
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER p4c_preview_stamp BEFORE INSERT ON p4c_dnb_event FOR EACH ROW EXECUTE FUNCTION p4c_preview_stamp();
CREATE FUNCTION p4c_f5_current_preview_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM b.id FROM lab_batch b JOIN p4c_dnb_attempt d ON d.batch_id=b.id WHERE d.id=NEW.dnb_id FOR UPDATE OF b;
 IF NOT EXISTS(SELECT 1 FROM p4c_dnb_event e WHERE e.dnb_id=NEW.dnb_id AND e.event_type='PREVIEW' AND e.actor_id=NEW.issued_by
 AND e.payload->>'kind'=NEW.kind AND e.payload->>'evidenceHash'=NEW.snapshot->>'evidenceHash'
 AND e.payload->>'databaseEvidenceToken'=p4c_evidence_token(NEW.dnb_id)) THEN RAISE EXCEPTION 'CURRENT_PREVIEW_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER p4c_f5_current_preview_guard BEFORE INSERT ON p4c_document FOR EACH ROW EXECUTE FUNCTION p4c_f5_current_preview_guard();
