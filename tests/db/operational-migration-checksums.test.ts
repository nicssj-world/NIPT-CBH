import {PGlite} from '@electric-sql/pglite';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {it,expect} from 'vitest';
import {migrate} from '../../tools/migrate';
import {compareLedger} from '../../tools/p8/health';
import {createHash} from 'node:crypto';

// Actual pre-checkout Operational ledger hashes; includes two mixed LF/CRLF files.
const historical=[
 ['084_operational_runtime.sql','f91e40062225bb273a9ac3ba4e8156edc5007d9e02e4de7cd0c1c90a55c927a2'],
 ['086_operational_lab_results.sql','993e6398e9e57d1f6c2111ad7b0545f9c0edfa95451ddc3b542d44c768a8d1a0'],
 ['088_p2_operational_clinical_review.sql','16dc8a002402503abc6b01b4f1fed714f440a6836a5fa6c5ff3c1d3ec2cb74fe'],
 ['092_native_controlled_documents.sql','2fabde5b36be4a80fabe179e0f2f92a7b0db0decdc00b33141a0a2ba3be2c3c9'],
 ['094_owner_three_sheet_master.sql','cf191d19a928bdbf7a94e57feda81f7380c2b3a864ba60822277fe4913591b14'],
];
it.each(historical)('accepts the verified historical bytes of %s without rewriting its ledger, but rejects SQL or checksum tampering',async(name,checksum)=>{
 const directory=await mkdtemp(join(tmpdir(),'nipt-historical-migration-')),db=new PGlite();
 try{
  const sql=await readFile(join('db/migrations',name),'utf8');await writeFile(join(directory,name),sql);
  await db.exec('CREATE TABLE schema_migration(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
  await db.query('INSERT INTO schema_migration(name,checksum) VALUES($1,$2)',[name,checksum]);
  const before=(await db.query('SELECT * FROM schema_migration')).rows;
  expect(compareLedger([{name,checksum:createHash('sha256').update(sql).digest('hex')}],[{name,checksum}])).toBe(true);
  await migrate(db,directory);await migrate(db,directory);expect((await db.query('SELECT * FROM schema_migration')).rows).toEqual(before);
  await writeFile(join(directory,'999.sql'),'CREATE TABLE should_not_apply(id integer)');
  await writeFile(join(directory,name),sql+'\n-- changed migration content');
  expect(compareLedger([{name,checksum:createHash('sha256').update(sql+'\n-- changed migration content').digest('hex')}],[{name,checksum}])).toBe(false);
  await expect(migrate(db,directory)).rejects.toThrow(/checksum mismatch/);
  expect((await db.query("SELECT to_regclass('should_not_apply') name")).rows).toEqual([{name:null}]);
  await writeFile(join(directory,name),sql);await db.query("UPDATE schema_migration SET checksum=$1",['0'.repeat(64)]);
  expect(compareLedger([{name,checksum:createHash('sha256').update(sql).digest('hex')}],[{name,checksum:'0'.repeat(64)}])).toBe(false);
  await expect(migrate(db,directory)).rejects.toThrow(/checksum mismatch/);
 }finally{await db.close();await rm(directory,{recursive:true,force:true});}
});
it('does not waive checksum changes for unlisted migrations, even for line endings alone',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'nipt-unlisted-migration-')),db=new PGlite();
 try{const file=join(directory,'001.sql');await writeFile(file,'CREATE TABLE ordinary(id integer);\n');await migrate(db,directory);await writeFile(file,'CREATE TABLE ordinary(id integer);\r\n');await expect(migrate(db,directory)).rejects.toThrow(/checksum mismatch/);}
 finally{await db.close();await rm(directory,{recursive:true,force:true});}
});
