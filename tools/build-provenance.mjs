import {writeFile} from 'node:fs/promises';
import {migrationInventory} from '../deploy/scripts/release-contract.mjs';
export async function buildProvenance(env=process.env){
 if(!/^[a-f0-9]{40}$/.test(env.SOURCE_REVISION??''))throw Error('SOURCE_REVISION_REQUIRED');
 const migrations=await migrationInventory('db/migrations');
 if(migrations.sha256!==env.MIGRATIONS_SHA256)throw Error('BAKED_MIGRATION_CONTENT_MISMATCH');
 const record={revision:env.SOURCE_REVISION,migrationsSha256:migrations.sha256,migrations:migrations.files};
 await writeFile('build-provenance.json',JSON.stringify(record));return record;
}
if(process.argv[1]?.endsWith('build-provenance.mjs'))await buildProvenance();
