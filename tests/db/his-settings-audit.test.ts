import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {testDatabase,addUser} from '../helpers/database';
import type {Queryable} from '../../packages/db/connection';
import {SETTINGS} from '../../packages/settings/catalog';
import {proposeSetting} from '../../packages/settings/service';
import {runHisSettingsTest} from '../../packages/jobs/his-settings-test';
import {verifyAuditChain} from '../../packages/db/audit';

let db:PGlite,revisionId:string;
beforeAll(async()=>{
 db=await testDatabase();vi.stubEnv('NIPT_MODE','synthetic');vi.stubEnv('SIMULATOR_ROOT',path.join(os.tmpdir(),'nipt-missing-audit-'+randomUUID()));
 const maker=await addUser(db);revisionId=await proposeSetting(db,maker,'his_inbound',SETTINGS.his_inbound.default,'AUDIT_TRANSACTION_TEST');
});
afterAll(async()=>{await db?.close();vi.unstubAllEnvs();});
function trace(){
 const statements:string[]=[];
 const client:Queryable={async query<T>(sql:string,values?:unknown[]){statements.push(sql);return db.query<T>(sql,values);}};
 return {client,statements};
}
async function chain(){return (await db.query<{previous_hash:string;hash:string;payload:string}>('SELECT previous_hash,hash,payload FROM audit_chain ORDER BY sequence')).rows;}

it('completion audit on an autocommit connection owns a short BEGIN/lock/tail/insert/COMMIT transaction',async()=>{
 const {client,statements}=trace();
 // No authorized simulator root is configured: a failed connection report is
 // still a genuine completion event and must be appended atomically.
 const report=await runHisSettingsTest(client,{revisionId,version:1,active:false});expect(report).toMatchObject({passed:false});
 expect(statements.slice(-5)[0]).toBe('BEGIN');expect(statements.slice(-5)[1]).toBe('SELECT pg_advisory_xact_lock(75432801)');expect(statements.slice(-5)[2]).toBe('SELECT hash FROM audit_chain ORDER BY sequence DESC LIMIT 1');expect(statements.slice(-5)[3]).toContain('INSERT INTO audit_chain');expect(statements.at(-1)).toBe('COMMIT');
 expect(statements.filter(sql=>sql==='BEGIN')).toHaveLength(1);expect(verifyAuditChain(await chain())).toBe(true);
 expect((await db.query('SELECT * FROM integration_job_receipt')).rows).toHaveLength(0);
});

it('real completion-audit insert failure rolls back without publishing a receipt or damaging the existing chain',async()=>{
 const before=await chain(),{client,statements}=trace();
 // Constraint belongs only to this disposable test database; no runtime schema changes.
 await db.query("ALTER TABLE audit_chain ADD CONSTRAINT his_audit_reject_fixture_action CHECK(action<>'HIS_SETTINGS_TEST_COMPLETED') NOT VALID");
 await expect(runHisSettingsTest(client,{revisionId,version:1,active:false})).rejects.toThrow(/check constraint/i);
 expect(statements).toContain('BEGIN');expect(statements.at(-1)).toBe('ROLLBACK');expect(statements).not.toContain('COMMIT');expect(await chain()).toEqual(before);expect(verifyAuditChain(await chain())).toBe(true);
 expect((await db.query('SELECT * FROM integration_job_receipt')).rows).toHaveLength(0);
});
