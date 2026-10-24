-- Task 1.5: registration evidence may precede clinical completion. Existing immutable rows are untouched.
ALTER TABLE lab_operational_registration ALTER COLUMN ga_weeks DROP NOT NULL;
ALTER TABLE lab_operational_registration ALTER COLUMN ga_days DROP NOT NULL;
ALTER TABLE lab_operational_registration ALTER COLUMN edd DROP NOT NULL;
ALTER TABLE lab_operational_registration ALTER COLUMN pregnancy DROP NOT NULL;
ALTER TABLE lab_operational_registration DROP CONSTRAINT lab_operational_registration_paper_consent_check;
ALTER TABLE lab_operational_registration ADD CONSTRAINT lab_registration_ga_pair CHECK ((ga_weeks IS NULL)=(ga_days IS NULL));
-- No allocation, identity, consent review, release or immutable-evidence trigger changes.
