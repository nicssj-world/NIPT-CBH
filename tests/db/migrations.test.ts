import {PGlite} from '@electric-sql/pglite';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {it,expect} from 'vitest';
import {migrate} from '../../tools/migrate';
import {safeDetails,verifyAuditChain,auditHash} from '../../packages/db/audit';
it('migration rejects changed and missing applied SQL before applying a new migration',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'nipt-migration-'));const db=new PGlite();
 try {
 await writeFile(join(directory,'001.sql'),'CREATE TABLE synthetic_test(id integer);');await migrate(db,directory);
 await writeFile(join(directory,'001.sql'),'CREATE TABLE synthetic_changed(id integer);');await writeFile(join(directory,'002.sql'),'CREATE TABLE should_not_apply(id integer);');
 await expect(migrate(db,directory)).rejects.toThrow(/checksum/);
 expect((await db.query("SELECT to_regclass('should_not_apply') AS name")).rows[0]).toEqual({name:null});
 await rm(join(directory,'001.sql'));await expect(migrate(db,directory)).rejects.toThrow(/missing/);
 }finally{await db.close();await rm(directory,{recursive:true,force:true});}
});
it('rejects unapproved audit content and detects chain tampering',()=>{expect(()=>safeDetails({ln:'000012'})).toThrow();expect(()=>safeDetails({outcome:'Patient Name'})).toThrow();const payload='{}';const hash=auditHash('GENESIS',payload);expect(verifyAuditChain([{previous_hash:'GENESIS',hash,payload}])).toBe(true);expect(verifyAuditChain([{previous_hash:'GENESIS',hash,payload:'tampered'}])).toBe(false);});
