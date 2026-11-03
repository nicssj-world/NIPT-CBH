import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {inboundFixture,register,registrar} from '../helpers/inbound';
import {tx} from '../helpers/lab';
import {registerEqaCase,updateEqaInfo,deleteEqaRegistration} from '../../packages/eqa/service';
import {listP2Cases,getCase} from '../../packages/p2/service';
import {dashboard} from '../../packages/anc/service';
import * as intake from '../../packages/lab/intake';
import * as batch from '../../packages/lab/batch';
import {version} from '../helpers/lab';

// Owner 2026-11-03: an EQA specimen appears in Quality Control only (not in the registry, the overviews or the results list), nurses never open it,
// and its basic data is typed on its own page and can be corrected until a report exists.
const card=(unitId:string,n:number)=>({
 ln:'9900010170'+String(n).padStart(2,'0'),unitId,idempotencyKey:'qco-'+n+'-a1b2c3d4e5f6a7b8c9d0e1f2',organizer:'GenQA/EMQN',programYear:2026,
 sampleRef:'99000071'+String(n).padStart(2,'0'),surname:'POLSON',firstName:'Tonya',dob:'1988-08-23',gaWeeks:11,gaDays:1,collectionDate:'2026-10-19',pregnancy:'Singleton' as const
});
const edit=(caseId:string,o:Record<string,unknown>={})=>({caseId,surname:'POLSON',firstName:'Tonya',dob:'1988-08-23',collectionDate:'2026-10-19',gaWeeks:11,gaDays:1,pregnancy:'Singleton',...o});

it('EQA is hidden from the registry and the nurse overview, nurses cannot open it, Lab can; a patient is unaffected',async()=>{
 const f=await inboundFixture();
 try{
  const {unit,anc,lab}=await registrar(f.db);
  const patient=await register(f,{ln:'9900010171',hn:'9900007171'});
  const eqa=await tx(f.db,()=>registerEqaCase(f.db,lab,card(unit,1),f.lookupKey,{store:f.store}));
  const ids=(await listP2Cases(f.db,lab,{pageSize:100})).cases.map(c=>c.id);
  expect(ids).not.toContain(eqa.caseId);expect(ids).toContain(patient);                      // registry / Lab overview: patients only
  expect((await listP2Cases(f.db,lab,{q:'990001017001'})).cases).toHaveLength(0);           // not even by searching its LN
  const overview=await dashboard(f.db,anc,{});
  expect(JSON.stringify(overview)).not.toContain(eqa.caseId);                                 // nurse overview: no row, no count
  await expect(getCase(f.db,anc,eqa.caseId)).rejects.toThrow('FORBIDDEN');                    // a nurse cannot open it even by URL
  const page=await getCase(f.db,lab,eqa.caseId);
  expect(page.eqa).toMatchObject({surname:'POLSON',firstName:'Tonya',sampleRef:'9900007101',editable:true});
  expect(page.patientName).toBe('Tonya POLSON');
  expect((await getCase(f.db,lab,patient)).eqa).toBeNull();                                    // a patient page is the normal one
  // Hidden from the lists, but still worked in the laboratory: it is in the Lab queue and can be put into a Task List.
  const queue=await tx(f.db,()=>intake.labWorklist(f.db,lab));
  const mine=queue.attempts.find(a=>a.roundId===eqa.roundId);expect(mine).toBeDefined();
  const b=await tx(f.db,()=>batch.createBatch(f.db,lab));
  const placed=await tx(f.db,async()=>batch.assignExact(f.db,lab,{batchId:b.batchId,expectedVersion:await version(f.db,b.batchId),attemptId:mine!.attemptId,slot:2,mode:'MANUAL'}));
  expect(placed.placed).toHaveLength(1);
 }finally{await f.close();}
},180000);

it('the basic data can be corrected until a report exists; identity stays fixed; a nurse cannot edit',async()=>{
 const f=await inboundFixture();
 try{
  const {unit,anc,lab}=await registrar(f.db);
  const {caseId,roundId}=await tx(f.db,()=>registerEqaCase(f.db,lab,card(unit,2),f.lookupKey,{store:f.store}));
  await expect(tx(f.db,()=>updateEqaInfo(f.db,anc,edit(caseId,{surname:'NURSE'})))).rejects.toThrow();
  expect((await tx(f.db,()=>updateEqaInfo(f.db,lab,edit(caseId)))).changed).toEqual([]);   // nothing changed: nothing written
  const r=await tx(f.db,()=>updateEqaInfo(f.db,lab,edit(caseId,{surname:'EDITED',gaWeeks:12,gaDays:3,pregnancy:'Twins',note:'จาก Referral card'})));
  expect(r.changed.sort()).toEqual(['ga_days','ga_weeks','note','pregnancy','surname']);
  const row=(await f.db.query<{surname:string;ga_weeks:number;pregnancy:string;note:string}>('SELECT surname,ga_weeks,pregnancy,note FROM eqa_case WHERE case_id=$1',[caseId])).rows[0];
  expect(row).toMatchObject({surname:'EDITED',ga_weeks:12,pregnancy:'Twins',note:'จาก Referral card'});
  const ev=(await f.db.query<{details:{fields:string[];before:{surname:string};after:{surname:string}}}>("SELECT details FROM case_event WHERE case_id=$1 AND event_type='EQA_INFO_EDITED'",[caseId])).rows;
  expect(ev).toHaveLength(1);expect(ev[0].details.before.surname).toBe('POLSON');expect(ev[0].details.after.surname).toBe('EDITED');   // the history keeps the old values
  await expect(f.db.query("UPDATE eqa_case SET sample_ref='CHANGED' WHERE case_id=$1",[caseId])).rejects.toThrow('append-only');          // identity is not editable
  // a report exists: locked, by the service and by the database
  await f.db.exec('BEGIN');await f.db.exec('SET LOCAL session_replication_role=replica');
  const id=randomUUID();
  await f.db.query("INSERT INTO result_report_version(id,intake_file_id,sha256,kind,template_kind,template_version,parser_version,parsed,case_id,round_id,imported_by) VALUES($1,$2,$3,'RESULT','SINGLETON','SYNTHETIC-v1','SYNTHETIC-v1','{}',$4,$5,$6)",[id,randomUUID(),id.replaceAll('-','').repeat(2),caseId,roundId,lab.id]);
  await f.db.exec('COMMIT');
  await expect(tx(f.db,()=>updateEqaInfo(f.db,lab,edit(caseId,{surname:'TOO LATE'})))).rejects.toThrow('EQA_INFO_LOCKED_AFTER_REPORT');
  await expect(f.db.query("UPDATE eqa_case SET surname='TOO LATE' WHERE case_id=$1",[caseId])).rejects.toThrow('EQA_INFO_LOCKED_AFTER_REPORT');
  expect((await getCase(f.db,lab,caseId)).eqa?.editable).toBe(false);
 }finally{await f.close();}
},180000);

it('an EQA registration is deleted in one step, no reason typed; the tombstone records a standing reason',async()=>{
 const f=await inboundFixture();
 try{
  const {unit,lab}=await registrar(f.db);
  const e=await tx(f.db,()=>registerEqaCase(f.db,lab,card(unit,3),f.lookupKey,{store:f.store}));
  await tx(f.db,()=>deleteEqaRegistration(f.db,lab,{caseId:e.caseId}));
  const t=(await f.db.query<{reason:string}>('SELECT reason FROM eqa_registration_deleted WHERE case_id=$1',[e.caseId])).rows;
  expect(t).toHaveLength(1);expect(t[0].reason.length).toBeGreaterThanOrEqual(3);
  expect((await f.db.query('SELECT 1 FROM nipt_case WHERE id=$1',[e.caseId])).rows).toHaveLength(0);
 }finally{await f.close();}
},180000);

it('an EQA whose request check / clinical evaluation was saved can still be deleted (migration 193)',async()=>{
 const f=await inboundFixture();
 try{
  const {unit,lab}=await registrar(f.db);
  const e=await tx(f.db,()=>registerEqaCase(f.db,lab,card(unit,4),f.lookupKey,{store:f.store}));
  await f.db.query("INSERT INTO clinical_snapshot(case_id,round_id,rule_version,input_snapshot,result) VALUES($1,$2,'SYNTHETIC-v1','{}','{}')",[e.caseId,e.roundId]);
  await tx(f.db,()=>deleteEqaRegistration(f.db,lab,{caseId:e.caseId}));
  expect((await f.db.query('SELECT 1 FROM clinical_snapshot WHERE case_id=$1',[e.caseId])).rows).toHaveLength(0);
  expect((await f.db.query('SELECT 1 FROM nipt_case WHERE id=$1',[e.caseId])).rows).toHaveLength(0);
 }finally{await f.close();}
},180000);
