-- Additive hardening: cancellation invalidates downstream evidence in the same
-- transaction. Do not rewrite any previously applied migration or original.
CREATE FUNCTION p4b_batch_cancelled() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 INSERT INTO p4b_pool_event(pool_id,event_type,payload,actor_id)
 SELECT p.id,'STOP_USE',jsonb_build_object('reason','BATCH_CANCELLED'),COALESCE(NEW.cancelled_by,p.created_by)
 FROM p4b_pool_attempt p WHERE p.batch_id=NEW.id AND NOT EXISTS(SELECT 1 FROM p4b_pool_event e WHERE e.pool_id=p.id AND e.event_type IN ('STOP_USE','SUPERSEDED'));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION p4b_batch_cancelled() FROM PUBLIC;
CREATE TRIGGER p4b_batch_cancelled AFTER UPDATE ON lab_batch FOR EACH ROW WHEN (NEW.state='Cancelled' AND OLD.state IS DISTINCT FROM NEW.state) EXECUTE FUNCTION p4b_batch_cancelled();
ALTER TABLE p4b_pool_attempt ADD CONSTRAINT p4b_attempt_synthetic_hold CHECK(payload @> '{"synthetic":true,"acceptance":"HOLD","calculation":{"clinicalUsable":false}}');
ALTER TABLE p4b_pool_snapshot ADD CONSTRAINT p4b_snapshot_synthetic_hold CHECK(payload @> '{"synthetic":true,"acceptance":"HOLD","exportAllowed":false}');
ALTER TABLE p4b_document ADD CONSTRAINT p4b_document_simulation_only CHECK(snapshot @> '{"form":"F4","synthetic":true,"clinicalUsable":false,"preview":false}');
ALTER TABLE p4b_pool_observation ADD CONSTRAINT p4b_numeric_value_unit CHECK(field='TRANSFER' OR
 (value ? 'value' AND value ? 'unit' AND value->>'unit'=CASE WHEN field='BUFFER' THEN 'uL' ELSE 'ng/uL' END));
