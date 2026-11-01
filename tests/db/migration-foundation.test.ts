import {describe,it,expect} from 'vitest';
import {testDatabase,addUser} from '../helpers/database';

describe('migration staging foundations',()=>{
 it('persists provisional mapping without fictitious patient, receipt or outbound evidence',async()=>{
  const db=await testDatabase();try{
   const user=await addUser(db);
   const x=(await db.query<{id:string}>("INSERT INTO migration_execution(plan_digest,plan,created_by) VALUES($1,'{}',$2) RETURNING id",['a'.repeat(64),user.id])).rows[0];
   await db.query("INSERT INTO migration_record(execution_id,source_key,ln,ln_halos,row_number,classification) VALUES($1,'row1','0012345678','26B261026152',2,'NO_HALOS')",[x.id]);
   expect((await db.query('SELECT * FROM nipt_case')).rows).toHaveLength(0);
   expect((await db.query('SELECT * FROM job_outbox')).rows).toHaveLength(0);
   expect((await db.query('SELECT case_id,his_pdf_exists FROM migration_record')).rows[0]).toEqual({case_id:null,his_pdf_exists:false});
  }finally{await db.close();}
 });
 it('reserves historical Run numbers without creating a laboratory batch',async()=>{
  const db=await testDatabase();try{
   const user=await addUser(db);
   const x=(await db.query<{id:string}>("INSERT INTO migration_execution(plan_digest,plan,created_by) VALUES($1,'{}',$2) RETURNING id",['b'.repeat(64),user.id])).rows[0];
   await db.query("INSERT INTO file_asset(sha256,byte_size,media_type,storage_key) VALUES($1,1,'application/octet-stream','test/c'),($2,1,'application/octet-stream','test/d')",['c'.repeat(64),'d'.repeat(64)]);
   await db.query("INSERT INTO migration_historical_run(execution_id,run_year,run_number,run_label,source_sha256) VALUES($1,2026,1,'Run001/2026',$2)",[x.id,'c'.repeat(64)]);
   expect((await db.query('SELECT * FROM lab_batch')).rows).toHaveLength(0);
   await expect(db.query("INSERT INTO migration_historical_run(execution_id,run_year,run_number,run_label,source_sha256) VALUES($1,2026,1,'Run001/2026',$2)",[x.id,'d'.repeat(64)])).rejects.toThrow();
  }finally{await db.close();}
 });
});
