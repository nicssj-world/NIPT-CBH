import type {PGlite} from '@electric-sql/pglite';

// Migration upgrade tests build a database that stops before migration 099/100 and then run the current services on it. The services
// read p2_consent_latest_decision (migration 102), so these tests install a neutral stand-in first and remove it before the full bundle
// applies the real migration. It is test scaffolding only and never part of a migration.
export const installPre102Stub=(db:PGlite)=>db.exec('CREATE FUNCTION p2_consent_latest_decision(target uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;');
export const removePre102Stub=(db:PGlite)=>db.exec('DROP FUNCTION p2_consent_latest_decision(uuid)');
