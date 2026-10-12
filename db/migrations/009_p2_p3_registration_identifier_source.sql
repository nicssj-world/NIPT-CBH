-- P2-P3 synthetic integration (Plan v6.2.1 §4.7 L3, §6.2 registration_attempt, D-40, AT-LDR-02). Additive only.
-- Records where the registrant read the identifiers for blind entry. The shared P2 service requires it for LAB_DIRECT;
-- earlier P1/P2 attempts and generic P1 fixtures remain NULL rather than being back-filled with an invented source.
ALTER TABLE registration_attempt ADD COLUMN identifier_source text CHECK(identifier_source IN ('TUBE_LABEL','REQUEST_FORM','PATIENT_DOCUMENT'));
