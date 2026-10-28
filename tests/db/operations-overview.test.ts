import {beforeAll,afterAll,expect,it} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase,addUser} from '../helpers/database';
import {readOperationsOverview} from '../../packages/results/operations-overview';

let db:PGlite;
beforeAll(async()=>{db=await testDatabase();});
afterAll(async()=>db?.close());

it('reads real current-schema admin KPIs and access audit with no patient data',async()=>{
 const admin=await addUser(db,'APP_ADMIN','synthetic.admin.operations');
 const staff=await addUser(db,'LAB_STAFF','synthetic.lab.operations');
 await db.query("INSERT INTO result_access_log(actor_id,purpose) VALUES($1,'ANC_RESULT_PRINT_VIEW')",[staff.id]);
 const summary=await readOperationsOverview(db,admin);
 expect(summary.released24h).toBe(0);
 expect(summary.archiveCounts).toEqual([]);
 expect(summary.exceptions).toEqual([]);
 expect(summary.pdfAccess7d).toEqual([{purpose:'ANC_RESULT_PRINT_VIEW',count:1}]);
 expect(summary.pdfAudit[0]?.purpose).toBe('ANC_RESULT_PRINT_VIEW');
 expect(summary.pdfAudit[0]?.actor_name).toBeTruthy();
 expect(Object.keys(summary).sort()).toEqual(['archiveCounts','exceptions','pdfAccess7d','pdfAudit','released24h']);
});
