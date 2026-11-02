import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {testDatabase,addUser} from '../helpers/database';import {syntheticCase,labUsers,receiveS1,tx} from '../helpers/lab';
import {simpleXlsx} from '../../packages/workbook/simple-xlsx';import {FileStore} from '../../packages/storage';
import {buildMigrationPlan} from '../../packages/migration/planner';import {executeMigration} from '../../packages/migration/service';
import {pinAllocatorEvidence,excelAllocatorEvidence} from '../../packages/migration/high-watermark';import {applyAllocatorHandover} from '../../packages/migration/identifiers';
// Owner decision 2026-11-02: the Excel mapping is the source of truth for the hand-over. Synthetic numbers only.
it('hands over from the Excel mapping: per-month high-water, no Genomic database, next number is last+1 and a month never borrows another counter',async()=>{
 const db=await testDatabase(),root=await mkdtemp(path.join(os.tmpdir(),'migration-excel-allocator-'));
 try{const admin=await addUser(db),u=await labUsers(db),next=await tx(db,d=>syntheticCase(d,{staff:u.staff,unit:u.unit}));
  const clock=(await db.query<{today:string;at:string}>("SELECT p4_bangkok_date(now())::text today,now()::text at")).rows[0],date=clock.today,month=date.slice(0,7)+'-01',yymm=date.slice(2,4)+date.slice(5,7);
  const current=date.slice(2,4)+'B'+yymm+date.slice(8,10)+'017',older='26B261001202';
  const input={mapping:{name:'mapping.xlsx',bytes:simpleXlsx('Mapping',[['LN','LN Halos'],['9900099001',older],['9900099002',current]])},halos:[]},plan=buildMigrationPlan(input);
  const deps={store:new FileStore(root),verifyBackup:async()=>({manifestSha256:'a'.repeat(64),verification:'CREATION_VERIFIED'})};
  const execution=await executeMigration(db,admin,input,{planDigest:plan.digest,uncheckedAcknowledged:true},deps);
  await expect(tx(db,d=>receiveS1(d,next))).rejects.toThrow('ALLOCATOR_HANDOVER_PENDING');
  const evidence=excelAllocatorEvidence(plan.mappings,plan.sources[0].sha256,{sourceIdentity:'owner-confirmed-excel-mapping',capturedAt:new Date(clock.at).toISOString()});
  expect(evidence.source).toBe('OWNER_CONFIRMED_EXCEL_MAPPING');
  expect(evidence.months).toEqual([{month:'2026-10-01',lastValue:202},{month,lastValue:17}].sort((a,b)=>a.month.localeCompare(b.month)));
  // an unnamed source is refused by the application check and by the database function itself
  await expect(applyAllocatorHandover(db,admin,execution.id,pinAllocatorEvidence({...evidence,source:'ANYTHING_ELSE'} as never))).rejects.toThrow('ALLOCATOR_EVIDENCE_INVALID');
  await expect(db.query('SELECT migration_apply_allocator_handover($1,$2,$3)',[execution.id,admin.id,JSON.stringify({...evidence,source:'ANYTHING_ELSE'})])).rejects.toThrow('ALLOCATOR_EVIDENCE_INVALID_OR_STALE');
  await expect(applyAllocatorHandover(db,u.staff,execution.id,evidence)).rejects.toThrow('FORBIDDEN');
  await applyAllocatorHandover(db,admin,execution.id,evidence);
  expect((await applyAllocatorHandover(db,admin,execution.id,evidence)).replayed).toBe(true);
  await tx(db,d=>receiveS1(d,next));
  expect((await db.query<{ln_halos:string}>('SELECT ln_halos FROM specimen_lab_number WHERE round_id=$1',[next.roundId])).rows[0].ln_halos).toMatch(/018$/);
  expect((await db.query<{last_value:number}>("SELECT last_value FROM ln_halos_monthly_sequence WHERE sequence_month='2026-10-01'")).rows[0].last_value).toBe(202);
  expect((await db.query('SELECT 1 FROM job_outbox')).rows).toHaveLength(0);
 }finally{await db.close();await rm(root,{recursive:true,force:true});}
});
