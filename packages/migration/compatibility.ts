import type {Queryable} from '../db/connection';

/** Server-side compatibility report read by Migration.exe before it lets anything run. It states facts about THIS server; the tool decides. */
export const COMPATIBILITY_FORMAT='NIPT_HISTORICAL_MIGRATION_COMPAT_V1';
/** The migration support is migrations 162-175 (renumbered from 143-156 in the candidate: 157-161 were already applied on Production). The base ledger still contains 142_run_release_ignores_photos.sql. */
export const BASELINE_FULL_INSTALLATION='1.1.0';
export const BASELINE_LAST_MIGRATION='142_run_release_ignores_photos.sql';
export const REQUIRED_MIGRATIONS=[
 '162_migration_sources_identifiers.sql','163_migration_halos_run_lineage.sql','164_migration_operational_binding.sql','165_migration_result_release.sql',
 '166_migration_his_presence.sql','167_migration_allocator_handover.sql','168_migration_pet_archive_unknown_mtime.sql','169_migration_review_provenance_lock.sql',
 '170_migration_execution_ward_mapping.sql','171_migration_historical_attempt_source.sql','172_migration_rerun_continuation.sql','173_migration_allocator_safe_sequence_cast.sql',
 '174_migration_reserved_number_helper.sql','175_migration_prepared_allocator_guard.sql'] as const;
export const CAPABILITIES=['PREVIEW','EXECUTE_ASYNC','CANCEL_RESUME','PDF_IDENTITY_MATCH','HISTORICAL_CONSENT_RULE','HIS_PRESENCE_NO_OUTBOUND','ALLOCATOR_HANDOVER','VERIFIED_BACKUP_GATE'] as const;

export async function migrationCompatibility(db:Queryable,env:Record<string,string|undefined>=process.env){
 const ledger=await db.query<{name:string}>('SELECT name FROM schema_migration ORDER BY name');
 const names=new Set(ledger.rows.map(r=>String(r.name)));
 const missing=REQUIRED_MIGRATIONS.filter(n=>!names.has(n));
 const baseline=names.has(BASELINE_LAST_MIGRATION);
 const reasons:string[]=[];
 if(!baseline)reasons.push('BASELINE_LEDGER_INCOMPLETE');
 if(missing.length)reasons.push('MIGRATION_SUPPORT_MIGRATIONS_MISSING');
 const unknownNewer=[...names].filter(n=>/^\d{3}_/.test(n)&&Number(n.slice(0,3))>175);
 return {format:COMPATIBILITY_FORMAT,baselineFullInstallation:BASELINE_FULL_INSTALLATION,baselineLastMigration:BASELINE_LAST_MIGRATION,baselineLedgerPresent:baseline,
  requiredMigrations:REQUIRED_MIGRATIONS.length,missingMigrations:missing,newerMigrations:unknownNewer.length,capabilities:[...CAPABILITIES],
  release:env.NIPT_RELEASE_VERSION??null,sourceHead:env.NIPT_BUILD_SHA??null,compatible:reasons.length===0,reasons};
}
