-- Owner 2026-11-10: nobody needs a second name. Migration 192 took the "approver is not the maker" rule out of the report-template table
-- (report_template_revision_check1) but missed the same rule inside report_template_active_guard, so a template could be approved by the person
-- who imported it and then never activated (REPORT_TEMPLATE_APPROVAL_REQUIRED). Same function, only that one condition removed: the revision
-- must still be Approved/Active/Archived, carry an approver, have passed its test and have no inspection errors, and its kind must match.
CREATE OR REPLACE FUNCTION report_template_active_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r report_template_revision; BEGIN
 SELECT * INTO r FROM report_template_revision WHERE id=NEW.revision_id;
 IF r.kind<>NEW.kind THEN RAISE EXCEPTION 'REPORT_TEMPLATE_KIND_MISMATCH'; END IF;
 IF r.state NOT IN('Approved','Active','Archived') OR r.approved_by IS NULL OR NOT r.test_passed
  OR jsonb_array_length(r.inspection->'errors')>0 THEN RAISE EXCEPTION 'REPORT_TEMPLATE_APPROVAL_REQUIRED'; END IF;
 RETURN NEW;
END $$;
