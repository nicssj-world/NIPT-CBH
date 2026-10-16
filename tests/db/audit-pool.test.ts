import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {Pool,type PoolClient} from 'pg';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase} from '../helpers/database';
import {appendAudit,auditHash,verifyAuditChain} from '../../packages/db/audit';
import type {Queryable} from '../../packages/db/connection';

let db:PGlite;
beforeAll(async()=>{db=await testDatabase();await db.query("ALTER TABLE audit_chain ADD CONSTRAINT audit_pool_reject_fixture_action CHECK(action<>'POOL_INSERT_FAILURE')");});
afterAll(async()=>{await db?.close();});
function pooledDatabase(){
 const pool=new Pool(),statements:string[]=[],release=vi.fn();
 const query=async<T>(sql:string,values?:unknown[])=>{statements.push(sql);return db.query<T>(sql,values);};
 // Actual Pool identity; its dedicated connection executes actual migrated SQL
 // and transaction rollback in PGlite, without opening any runtime service.
 const client={query,release} as unknown as PoolClient;
 const connect=vi.spyOn(pool,'connect').mockImplementation((()=>Promise.resolve(client)) as typeof pool.connect);
 vi.spyOn(pool,'query').mockImplementation(query as typeof pool.query);
 return {pool,statements,release,connect};
}
async function chain(){return (await db.query<{previous_hash:string;hash:string;payload:string}>('SELECT previous_hash,hash,payload FROM audit_chain ORDER BY sequence')).rows;}

it('actual Pool acquires one connection and atomically locks, reads tail, appends identical payload bytes, commits, releases',async()=>{
 const fixture=pooledDatabase();
 try{
  const hash=await appendAudit(fixture.pool,{action:'POOL_APPEND_TEST',resourceType:'SYSTEM',details:{version:1,outcome:'PASSED'}});
  expect(fixture.connect).toHaveBeenCalledTimes(1);expect(fixture.statements[0]).toBe('BEGIN');expect(fixture.statements[1]).toBe('SELECT pg_advisory_xact_lock(75432801)');expect(fixture.statements[2]).toBe('SELECT hash FROM audit_chain ORDER BY sequence DESC LIMIT 1');expect(fixture.statements[3]).toContain('INSERT INTO audit_chain');expect(fixture.statements[4]).toBe('COMMIT');expect(fixture.release).toHaveBeenCalledTimes(1);
  const rows=await chain(),last=rows.at(-1)!;
  expect(last.payload).toBe('{"actorId":null,"action":"POOL_APPEND_TEST","resourceType":"SYSTEM","resourceId":null,"details":{"outcome":"PASSED","version":1}}');expect(hash).toBe(auditHash(last.previous_hash,last.payload));expect(verifyAuditChain(rows)).toBe(true);
 }finally{await fixture.pool.end();}
});

it('pooled insert constraint failure rolls back the real transaction, releases once, and permits a later valid append',async()=>{
 const fixture=pooledDatabase(),before=await chain();
 try{
  await expect(appendAudit(fixture.pool,{action:'POOL_INSERT_FAILURE',resourceType:'SYSTEM'})).rejects.toThrow(/check constraint/i);
  expect(fixture.statements[0]).toBe('BEGIN');expect(fixture.statements.at(-1)).toBe('ROLLBACK');expect(fixture.statements).not.toContain('COMMIT');expect(fixture.release).toHaveBeenCalledTimes(1);expect(await chain()).toEqual(before);
  await appendAudit(fixture.pool,{action:'POOL_AFTER_ROLLBACK',resourceType:'SYSTEM'});expect(fixture.release).toHaveBeenCalledTimes(2);expect(verifyAuditChain(await chain())).toBe(true);
 }finally{await fixture.pool.end();}
});

it('pooled unsafe details roll back without inserting sensitive content',async()=>{
 const fixture=pooledDatabase(),before=await chain();
 try{
  await expect(appendAudit(fixture.pool,{action:'POOL_REDACTION_TEST',resourceType:'SYSTEM',details:{patientName:'SECRET'}})).rejects.toThrow('Unsafe audit details');
  expect(fixture.statements.at(-1)).toBe('ROLLBACK');expect(fixture.release).toHaveBeenCalledTimes(1);expect(await chain()).toEqual(before);
 }finally{await fixture.pool.end();}
});

it('caller-owned Queryable transaction is neither committed nor nested; caller rollback removes its audit',async()=>{
 const before=await chain(),statements:string[]=[];
 const client:Queryable={async query<T>(sql:string,values?:unknown[]){statements.push(sql);return db.query<T>(sql,values);}};
 await db.query('BEGIN');
 try{await appendAudit(client,{action:'CALLER_TRANSACTION_TEST',resourceType:'SYSTEM'});expect((await chain()).length).toBe(before.length+1);expect(statements.some(sql=>['BEGIN','COMMIT','ROLLBACK'].includes(sql))).toBe(false);}
 finally{await db.query('ROLLBACK');}
 expect(await chain()).toEqual(before);
});
