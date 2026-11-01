import type {PGlite} from '@electric-sql/pglite';

// Migration upgrade tests build a database that stops before migration 099/100 and then run the current services on it. The services
// read p2_consent_latest_decision (migration 102), so these tests install a neutral stand-in first and remove it before the full bundle
// applies the real migration. It is test scaffolding only and never part of a migration.
export const installPre102Stub=(db:PGlite)=>db.exec(`
-- Current read service also projects the new ordinal; this pinned S1-only fixture
-- never applies migration123 and cannot exercise repeat allocation.
ALTER TABLE analytical_attempt ADD COLUMN overall_ordinal integer NOT NULL DEFAULT 1;
CREATE FUNCTION p2_consent_latest_decision(target uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
-- These pinned-prefix tests run today's read services against a pre-115 database.
-- There are no clock corrections or Lab registrations at that prefix. Preserve
-- exactly its raw values, with empty optional registrations, for the read port.
-- The tests never apply migration 113/115 to this temporary scaffolding.
CREATE VIEW specimen_round_current AS SELECT * FROM specimen_round;
CREATE VIEW his_order_current AS SELECT * FROM his_order;
CREATE VIEW his_inbound_file_current AS SELECT * FROM his_inbound_file;
CREATE TABLE lab_operational_registration(round_id uuid,case_id uuid,paper_request boolean,paper_consent boolean,created_at timestamptz,edd date,pregnancy text);
-- Today's result services also consult the historical-migration bridge (migrations 143-156). At this prefix no case was
-- migrated, so empty stand-ins keep every version on the ordinary non-migration path.
CREATE TABLE migration_record(id uuid,execution_id uuid,case_id uuid,round_id uuid,attempt_id uuid,ln text,ln_halos text,classification text,his_pdf_exists boolean,state text,row_version integer);
CREATE TABLE migration_analysis(id uuid,record_id uuid,attempt_id uuid,source_id uuid,run_label text,sample_raw text,attempt_number integer,is_current boolean,advice_status text,classification text,values jsonb,interpretation jsonb);
CREATE TABLE migration_source(id uuid,sha256 text);
CREATE TABLE migration_historical_run(run_label text,source_sha256 text);
CREATE FUNCTION migration_result_source_current(vid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION migration_result_review_current(vid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
`);
export const removePre102Stub=(db:PGlite)=>db.exec('DROP FUNCTION p2_consent_latest_decision(uuid)');
