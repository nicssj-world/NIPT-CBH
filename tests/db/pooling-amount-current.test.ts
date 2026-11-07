import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {expect,it} from 'vitest';

it('changing pooling amount invalidates recorded transfers while metadata edits preserve them',async()=>{
 const db=new PGlite();try{
  await db.exec(`CREATE TABLE lab_batch(id uuid,state text);
   CREATE TABLE task_workbook_revision(id uuid,batch_id uuid,revision int,values jsonb,source_snapshot jsonb);
   CREATE TABLE lab_actual_pooling(id uuid,batch_id uuid,workbook_revision_id uuid,recorded_at timestamptz,placements jsonb,qc_values jsonb);
   CREATE TABLE lab_batch_removal(batch_id uuid);`);
  for(const file of readdirSync('db/migrations').sort()){
   const sql=readFileSync('db/migrations/'+file,'utf8');
   for(const match of sql.matchAll(/CREATE (?:OR REPLACE )?FUNCTION lab_actual_pooling_current\(target uuid\)[\s\S]*?\$\$;/g))await db.exec(match[0]);
  }
  const batch='00000000-0000-4000-8000-000000000001',revision='00000000-0000-4000-8000-000000000002',actual='00000000-0000-4000-8000-000000000003';
  await db.query(`INSERT INTO lab_batch VALUES($1,'Open');`,[batch]);
  await db.query(`INSERT INTO task_workbook_revision VALUES($1,$2,1,'{"slot.1.libraryQc":20}','{"placements":[]}')`,[revision,batch]);
  await db.query(`INSERT INTO lab_actual_pooling VALUES($1,$2,$3,now(),'[]','{"slot.1.libraryQc":20}')`,[actual,batch,revision]);
  const current=async()=>(await db.query<{current:boolean}>('SELECT lab_actual_pooling_current($1) current',[actual])).rows[0].current;
  expect(await current()).toBe(true);
  await db.query(`INSERT INTO task_workbook_revision VALUES(gen_random_uuid(),$1,2,'{"slot.1.libraryQc":20,"pool.amount":16,"pool.operator":"SYNTHETIC"}','{"placements":[]}')`,[batch]);
  expect(await current()).toBe(true);
  await db.query(`INSERT INTO task_workbook_revision VALUES(gen_random_uuid(),$1,3,'{"slot.1.libraryQc":20,"pool.amount":12}','{"placements":[]}')`,[batch]);
  expect(await current()).toBe(false);
 }finally{await db.close();}
});
