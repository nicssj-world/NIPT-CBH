-- Restricted synthetic deployment: clinical QC5/acceptance adapter is not implemented.
-- Protect INSERT as well as UPDATE, including owner writes; no runtime role/GUC bypass.
CREATE FUNCTION p7_closed_clinical_state_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.state IN ('AnalysisComplete','FinalQcAccepted','Final') THEN
  IF TG_OP='INSERT' THEN RAISE EXCEPTION 'CLINICAL_QC_ADAPTER_PENDING'; END IF;
  IF NEW.state IS DISTINCT FROM OLD.state THEN RAISE EXCEPTION 'CLINICAL_QC_ADAPTER_PENDING'; END IF;
 END IF;
 RETURN NEW;
END $$;
-- Alphabetical trigger ordering makes the explicit closed-adapter rejection independent
-- of whether an attempted transition also violates the ordinary transition guard.
CREATE TRIGGER a_p7_closed_clinical_state BEFORE INSERT OR UPDATE ON analytical_attempt
 FOR EACH ROW EXECUTE FUNCTION p7_closed_clinical_state_guard();
REVOKE ALL ON FUNCTION p7_closed_clinical_state_guard() FROM PUBLIC;
