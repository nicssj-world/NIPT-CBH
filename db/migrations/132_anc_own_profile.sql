-- Personal signature is account-owned contact data; never a report/Consent signature.
ALTER TABLE app_user ADD COLUMN personal_signature jsonb;
ALTER TABLE app_user ADD CONSTRAINT personal_signature_object CHECK(personal_signature IS NULL OR jsonb_typeof(personal_signature)='object');
