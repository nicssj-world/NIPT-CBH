import type {PGlite} from '@electric-sql/pglite';

// Migration upgrade tests build a database that stops before migration 099/100 and then run the current services on it. The services
// read p2_consent_latest_decision (migration 102), so these tests install a neutral stand-in first and remove it before the full bundle
// applies the real migration. It is test scaffolding only and never part of a migration.
export const installPre102Stub=(db:PGlite)=>db.exec(`
CREATE FUNCTION p2_consent_latest_decision(target uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
-- These pinned-prefix tests run today's read services against a pre-115 database.
-- There are no clock corrections or Lab registrations at that prefix. Preserve
-- exactly its raw values, with empty optional registrations, for the read port.
-- The tests never apply migration 113/115 to this temporary scaffolding.
CREATE VIEW specimen_round_current AS SELECT * FROM specimen_round;
CREATE VIEW his_order_current AS SELECT * FROM his_order;
CREATE VIEW his_inbound_file_current AS SELECT * FROM his_inbound_file;
CREATE TABLE lab_operational_registration(round_id uuid,case_id uuid,paper_request boolean,paper_consent boolean,created_at timestamptz,edd date,pregnancy text);
`);
export const removePre102Stub=(db:PGlite)=>db.exec('DROP FUNCTION p2_consent_latest_decision(uuid)');
