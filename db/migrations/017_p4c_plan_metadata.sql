-- Frozen template metadata is part of the existing HALOS synthetic contract.
CREATE FUNCTION p4c_plan_metadata_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE p jsonb; BEGIN
 IF NEW.mapping_status='MAPPING_UNAVAILABLE' THEN RETURN NEW; END IF;
 p:=NEW.payload->'cellPlan';
 IF p->>'contract' IS DISTINCT FROM 'p4b-halos-synthetic-v1' OR p->>'usage' IS DISTINCT FROM 'synthetic-cell-plan-only'
 OR p->'headers' IS DISTINCT FROM '["*Sample ID","*Lane ID","*DNB ID\n(20 characters limited)","*Barcode ID","Sub-Library Conc. (ng/μl)"]'::jsonb
 OR p->'lineage'->>'templateSha256' IS DISTINCT FROM '1e4ffc979235f3221ca637f37476713c3a02bc7a5c541c8d32688f4af9c0caec'
 OR p->'lineage'->>'mappingStatus' IS DISTINCT FROM 'synthetic-fixture-unverified'
 OR p->'lineage'->'dnb'->>'id' IS DISTINCT FROM NEW.payload->>'dnbLabel'
 OR (p->'lineage'->>'handoffRevision')::int IS DISTINCT FROM NEW.revision THEN RAISE EXCEPTION 'HALOS_PLAN_METADATA_MISMATCH'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER p4c_plan_metadata_guard BEFORE INSERT ON p4c_handoff FOR EACH ROW EXECUTE FUNCTION p4c_plan_metadata_guard();
