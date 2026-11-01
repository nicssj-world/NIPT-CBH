import {describe,it,expect,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {testDatabase,addUser} from '../helpers/database';import {configureOperational} from '../../tools/configure-operational';
import {simpleXlsx} from '../../packages/workbook/simple-xlsx';import {FileStore} from '../../packages/storage';
import {buildMigrationPlan} from '../../packages/migration/planner';import {executeMigration} from '../../packages/migration/service';
import {bindMigrationPet} from '../../packages/migration/pet-enrichment';import {buildSyntheticPet} from '../../packages/inbound/wire';import {parsePet} from '../../packages/integrations/pet';
import {halosWorkbook} from '../../tools/task3-uat/halos-fixture';
import {previewLabels} from '../../packages/lab/intake';
describe('source-backed operational migration binding',()=>{
 it.each([false,true])('uses verified PET ward and preserves history without invented repeat requests (historical rerun=%s)',async historical=>{
  const db=await testDatabase(),root=await mkdtemp(path.join(os.tmpdir(),'migration-pet-'));vi.stubEnv('NIPT_MODE','operational');vi.stubEnv('APP_ORIGIN','https://127.0.0.1:20368');
  try{await configureOperational(db);const admin=await addUser(db);const store=new FileStore(root);
   const unit=(await db.query<{id:string}>("INSERT INTO unit(code,name) VALUES('MIGRATION-WARD','Synthetic migration sending unit') RETURNING id")).rows[0];
   const input={mapping:{name:'mapping.xlsx',bytes:simpleXlsx('Mapping',[['LN','LN Halos'],['9900099001','26B261026152']])},halos:historical?[
    {name:'run1.xlsx',runLabel:'Run001/2026',bytes:halosWorkbook({result:[{sample:'26B261026152-1',advice:'Rerun',chip:'SYNTHETIC-1'}],sampleinfo:[{id:'26B261026152',fetus:'Singleton',ga:'12,2'}]})},
    {name:'run2.xlsx',runLabel:'Run002/2026',bytes:halosWorkbook({result:[{sample:'26B261026152-2',chip:'SYNTHETIC-2'}],sampleinfo:[{id:'26B261026152',fetus:'Singleton',ga:'12,2'}]})},
   ]:[]};const p=buildMigrationPlan(input);
   const x=await executeMigration(db,admin,input,{planDigest:p.digest,uncheckedAcknowledged:true},{store,verifyBackup:async()=>({manifestSha256:'a'.repeat(64),verification:'CREATION_VERIFIED'})});
   const {bytes}=buildSyntheticPet({ln:'9900099001',hn:'9900012345',name:'SYNTHETIC^^นาง SYNTHETIC',receivedAt:'20261026090000',specimenAt:'20261026080000',ward:'MIGRATION-WARD'}),pet=parsePet(bytes,'9900099001-7.pet');
   const result=await bindMigrationPet(db,admin,x.records[0].id,{sourceName:'synthetic archive',relativePath:'20261026/9900099001-7.pet',sha256:pet.hash,byteLength:bytes.length,bytes,pet},store,Buffer.alloc(32,3));
   expect(result.outcome).toBe('BOUND');expect((await db.query('SELECT ln_halos,issued_on FROM specimen_lab_number')).rows).toEqual([{ln_halos:'26B261026152',issued_on:'MIGRATION_SOURCE'}]);
   expect((await db.query('SELECT unit_id FROM case_unit_scope')).rows).toEqual([{unit_id:unit.id}]);
   expect((await db.query('SELECT * FROM ln_halos_monthly_sequence')).rows).toHaveLength(0);
   for(const t of ['result_qc5_review','attempt_stage_qc','p2_document_revision','job_outbox','repeat_work_order'])expect((await db.query('SELECT * FROM '+t)).rows).toHaveLength(0);
   expect((await db.query('SELECT * FROM analytical_attempt')).rows).toHaveLength(historical?2:1);
   const roundId=(await db.query<{round_id:string}>('SELECT round_id FROM migration_record')).rows[0].round_id;
   const labels=await previewLabels(db,admin,{roundIds:[roundId],includeName:false});expect(labels.codes).toEqual(['26B261026152']);
  }finally{vi.unstubAllEnvs();await db.close();await rm(root,{recursive:true,force:true});}
 });
});
