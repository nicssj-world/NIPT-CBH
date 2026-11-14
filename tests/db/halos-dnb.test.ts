import {afterAll,beforeAll,expect,it} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {testDatabase} from '../helpers/database';
import type {Queryable} from '../../packages/db/connection';
import {latestHalosDnbId} from '../../packages/lab/halos-dnb';
import {bangkokDnbId} from '../../packages/sequencing/owner-task-import';

let db:PGlite;const q=()=>db as unknown as Queryable;
beforeAll(async()=>{db=await testDatabase();});
afterAll(async()=>{await db?.close();});
/** Export-pair fixture (FKs off): only the batch, the manifest and the time matter here. */
async function pair(batch:string,manifest:Record<string,unknown>,at:string){
 await db.query('BEGIN');await db.query('SET LOCAL session_replication_role=replica');
 await db.query(`INSERT INTO lab_seq_export_pair(batch_id,workbook_revision_id,actual_pooling_id,nifty_export_id,halos_export_id,idempotency_key,manifest,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
  [batch,randomUUID(),randomUUID(),randomUUID(),randomUUID(),randomUUID(),JSON.stringify(manifest),randomUUID(),at]);
 await db.query('COMMIT');
}
it('Seq Task-G50 DNB ID = the *DNB ID of the newest HALOS Task export (Owner 2026-11-14)',async()=>{
 const batch=randomUUID();
 expect(await latestHalosDnbId(q(),batch)).toBeNull();
 // An export made before the DNB ID was stored: derived from its click time (Bangkok day), exactly as the file was written.
 await pair(batch,{clickedAt:'2026-11-08T18:30:00Z'},'2026-11-08T18:30:01Z');
 expect(await latestHalosDnbId(q(),batch)).toBe('DNB20261109');
 expect(bangkokDnbId(new Date('2026-11-08T18:30:00Z'))).toBe('DNB20261109');
 // A newer export with the stored value wins.
 await pair(batch,{dnbId:'DNB20261113',clickedAt:'2026-11-13T03:00:00Z'},'2026-11-13T03:00:01Z');
 expect(await latestHalosDnbId(q(),batch)).toBe('DNB20261113');
 expect(await latestHalosDnbId(q(),randomUUID())).toBeNull();
});
