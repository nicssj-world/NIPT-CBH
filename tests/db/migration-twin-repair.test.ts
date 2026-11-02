import {describe,it,expect,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {testDatabase,addUser} from '../helpers/database';import {configureOperational} from '../../tools/configure-operational';
import {simpleXlsx} from '../../packages/workbook/simple-xlsx';import {FileStore} from '../../packages/storage';
import {buildMigrationPlan} from '../../packages/migration/planner';import {executeMigration} from '../../packages/migration/service';
import {bindMigrationPet} from '../../packages/migration/pet-enrichment';import type {PetCandidate} from '../../packages/migration/pet-source';import {buildSyntheticPet} from '../../packages/inbound/wire';import {parsePet} from '../../packages/integrations/pet';
import {halosWorkbook} from '../../tools/task3-uat/halos-fixture';
import {repairTwinAttachments,backfillPaperMarkers} from '../../packages/migration/twin-repair';
import {migrationPdfTargets} from '../../packages/migration/bulk-pdf';
// Reproduce Production: the first import ran with the parser that did not know the D form. The flag switches the identity rule back to that one.
let legacy=true;
vi.mock('../../packages/migration/lineage',async importOriginal=>{
 const real=await importOriginal<typeof import('../../packages/migration/lineage')>();
 return {...real,resolveMigrationIdentity:(sample:string,mapping:readonly string[],info:readonly string[])=>{
  if(!legacy)return real.resolveMigrationIdentity(sample,mapping,info);
  if(mapping.includes(sample))return {baseId:sample,attemptOrdinal:1};
  const m=/^(.+)-([1-9][0-9]?)$/.exec(sample);
  return !m||!mapping.includes(m[1])||!info.includes(m[1])?{baseId:null,attemptOrdinal:null}:{baseId:m[1],attemptOrdinal:Number(m[2])};
 }};
});
describe('twin D-n analysis imported before the parser knew the D form',()=>{
 it('is attached once to the existing case and bare first attempt, with audit, and never twice; paper markers are backfilled',async()=>{
  const db=await testDatabase(),root=await mkdtemp(path.join(os.tmpdir(),'migration-twin-'));vi.stubEnv('NIPT_MODE','operational');vi.stubEnv('APP_ORIGIN','https://127.0.0.1:20368');
  try{await configureOperational(db);const admin=await addUser(db);const store=new FileStore(root);
   await db.query("INSERT INTO unit(code,name) VALUES('MIGRATION-WARD','Synthetic migration sending unit')");
   const input={mapping:{name:'mapping.xlsx',bytes:simpleXlsx('Mapping',[['LN','LN Halos'],['9900099001','26B261026152'],['9900099002','26B261026153']])},halos:[
    {name:'run1.xlsx',runLabel:'Run001/2026',bytes:halosWorkbook({result:[{sample:'26B261026152-1',chip:'SYNTHETIC-1'},{sample:'26B261026153D-1',chip:'SYNTHETIC-1',barcode:'2.0'}],sampleinfo:[{id:'26B261026152',fetus:'Singleton',ga:'12,2'},{id:'26B261026153D',fetus:'Twins',ga:'12,2'}]})}]};
   const plan=buildMigrationPlan(input);
   await executeMigration(db,admin,input,{planDigest:plan.digest,uncheckedAcknowledged:true},{store,verifyBackup:async()=>({manifestSha256:'a'.repeat(64),verification:'CREATION_VERIFIED'})});
   const bind=async(ln:string,hn:string,recordId:string)=>{const {bytes}=buildSyntheticPet({ln,hn,name:'SYNTHETIC^^นาง SYNTHETIC',receivedAt:'20261026090000',specimenAt:'20261026080000',ward:'MIGRATION-WARD'}),pet=parsePet(bytes,ln+'-7.pet');
    return bindMigrationPet(db,admin,recordId,{sourceName:'synthetic archive',relativePath:'20261026/'+ln+'-7.pet',sha256:pet.hash,byteLength:bytes.length,bytes,pet} as PetCandidate,store,Buffer.alloc(32,3));};
   const rec=async(ln:string)=>(await db.query<{id:string}>('SELECT id FROM migration_record WHERE ln=$1',[ln])).rows[0].id;
   for(const [ln,hn] of [['9900099001','9900012345'],['9900099002','9900012346']] as const)expect((await bind(ln,hn,await rec(ln))).outcome).toBe('BOUND');
   // state as in Production: the twin row is an unresolved HALOS row, its case has a bare attempt, its record has no analysis
   const twinRecord=await rec('9900099002');
   expect((await db.query("SELECT classification FROM migration_analysis WHERE sample_raw='26B261026153D-1'")).rows).toEqual([{classification:'UNRESOLVED'}]);
   expect((await db.query<{printed_sample_id:string|null}>("SELECT t.printed_sample_id FROM analytical_attempt t JOIN migration_record m ON m.attempt_id=t.id WHERE m.id=$1",[twinRecord])).rows).toEqual([{printed_sample_id:null}]);
   const casesBefore=(await db.query('SELECT 1 FROM nipt_case')).rows.length,attemptsBefore=(await db.query('SELECT 1 FROM analytical_attempt')).rows.length,analysesBefore=(await db.query('SELECT 1 FROM migration_analysis')).rows.length;
   legacy=false;
   const first=await repairTwinAttachments(db,admin);
   expect(first).toMatchObject({repaired:1,skipped:0,records:[twinRecord]});
   expect((await db.query("SELECT classification,is_current,attempt_number,record_id=$1 same FROM migration_analysis WHERE sample_raw='26B261026153D-1'",[twinRecord])).rows).toEqual([{classification:'ANALYSIS',is_current:true,attempt_number:1,same:true}]);
   expect((await db.query<{printed_sample_id:string;state:string}>("SELECT t.printed_sample_id,t.state FROM analytical_attempt t JOIN migration_record m ON m.attempt_id=t.id WHERE m.id=$1",[twinRecord])).rows[0]).toMatchObject({printed_sample_id:'26B261026153D-1',state:'Ready'});
   expect((await db.query("SELECT a.attempt_id=m.attempt_id same FROM migration_analysis a JOIN migration_record m ON m.id=a.record_id WHERE a.sample_raw='26B261026153D-1'")).rows).toEqual([{same:true}]);
   expect((await db.query("SELECT classification FROM migration_record WHERE id=$1",[twinRecord])).rows).toEqual([{classification:'QUALIFIED_PDF_PENDING'}]);
   expect((await db.query("SELECT event FROM migration_record_event WHERE record_id=$1 AND event='TWIN_ANALYSIS_ATTACHED'",[twinRecord])).rows).toHaveLength(1);
   // nothing is created; a second call changes nothing
   expect((await db.query('SELECT 1 FROM nipt_case')).rows.length).toBe(casesBefore);expect((await db.query('SELECT 1 FROM analytical_attempt')).rows.length).toBe(attemptsBefore);expect((await db.query('SELECT 1 FROM migration_analysis')).rows.length).toBe(analysesBefore);
   expect(await repairTwinAttachments(db,admin)).toMatchObject({repaired:0});
   expect((await db.query("SELECT event FROM migration_record_event WHERE event='TWIN_ANALYSIS_ATTACHED'")).rows).toHaveLength(1);
   // the PDF path now finds exactly this attempt by the printed sample ID with its D-n suffix
   const targets=await migrationPdfTargets(db);
   expect(targets.filter(t=>t.sampleRaw.trim()==='26B261026153D-1')).toMatchObject([{recordId:twinRecord,current:true,qualified:true,attemptNumber:1}]);
   // the immutability guards themselves are unchanged for everything else
   await expect(db.query("UPDATE migration_analysis SET record_id=NULL WHERE sample_raw='26B261026153D-1'")).rejects.toThrow('MIGRATION_ANALYSIS_IMMUTABLE');
   await expect(db.query("UPDATE analytical_attempt SET historical_source_id=NULL WHERE printed_sample_id='26B261026153D-1'")).rejects.toThrow('HISTORICAL_ATTEMPT_SOURCE_IMMUTABLE');
   // paper markers: a migrated case's workspace created as Electronic is moved to Paper/Paper once, with an event, and nothing else changes
   const caseId=(await db.query<{case_id:string;round_id:string}>('SELECT case_id,round_id FROM migration_record WHERE id=$1',[twinRecord])).rows[0];
   await db.query("INSERT INTO p2_workspace(round_id,case_id,draft,request_mode,consent_mode,updated_by) VALUES($1,$2,'{}','Paper','Electronic',$3)",[caseId.round_id,caseId.case_id,admin.id]);
   expect(await backfillPaperMarkers(db,admin)).toEqual({updated:1});
   expect((await db.query("SELECT request_mode,consent_mode,version FROM p2_workspace WHERE round_id=$1",[caseId.round_id])).rows).toEqual([{request_mode:'Paper',consent_mode:'Paper',version:1}]);
   expect(await backfillPaperMarkers(db,admin)).toEqual({updated:0});
   expect((await db.query("SELECT 1 FROM case_event WHERE event_type='HISTORICAL_PAPER_MARKERS'")).rows).toHaveLength(1);
  }finally{legacy=true;vi.unstubAllEnvs();await db.close();await rm(root,{recursive:true,force:true});}
 });
});
