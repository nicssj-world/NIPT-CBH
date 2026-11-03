import {it,expect} from 'vitest';
import {inboundFixture,register,registrar,writePet,cycle} from '../helpers/inbound';
import {tx} from '../helpers/lab';
import {registerEqaCase,deleteEqaRegistration} from '../../packages/eqa/service';
import {attemptFacts,commonFacts} from '../../packages/lab/core';
import {commonPredicates} from '../../packages/lab/gate';

type Fixture=Awaited<ReturnType<typeof inboundFixture>>;
const card=(unitId:string,n:number,o:Partial<Record<string,unknown>>={})=>({
 ln:'9900010160'+String(n).padStart(2,'0'),unitId,idempotencyKey:'lnh-'+n+'-a1b2c3d4e5f6a7b8c9d0e1f2',organizer:'GenQA/EMQN',programYear:2026,
 sampleRef:'99000061'+String(n).padStart(2,'0'),surname:'POLSON',firstName:'Tonya',dob:'1988-08-23',gaWeeks:11,gaDays:1,collectionDate:'2026-10-19',pregnancy:'Singleton',...o
});
const seq=(code:string)=>Number(code.slice(-3));
/** An ordinary patient: registered, PET received from HIS, LN Halos issued by the receipt trigger. */
const patient=async(f:Fixture,n:number)=>{
 const ln='99000101'+String(n).padStart(4,'0'),hn='990000620'+n,caseId=await register(f,{ln,hn});
 await writePet(f.root,'20261101',{ln,hn,receivedAt:'20261101090000',specimenAt:'20261101080000'});
 await cycle(f,{now:new Date('2026-11-01T05:00:00Z')});
 return (await f.db.query<{ln_halos:string}>('SELECT n.ln_halos FROM specimen_lab_number n JOIN specimen_round r ON r.id=n.round_id WHERE r.case_id=$1',[caseId])).rows[0].ln_halos;
};
const err=(p:Promise<unknown>)=>p.then(()=>'OK',e=>String((e as Error).message));
const replica=async(f:Fixture,fn:()=>Promise<unknown>)=>{await f.db.exec('BEGIN');try{await f.db.exec('SET LOCAL session_replication_role=replica');await fn();await f.db.exec('COMMIT');}catch(e){await f.db.exec('ROLLBACK');throw e;}};

it('EQA numbers come from their own block: the patient running number is untouched and never has a gap',async()=>{
 const f=await inboundFixture();
 try{
  const {unit,lab}=await registrar(f.db);
  const p1=await patient(f,1);
  const e1=await tx(f.db,()=>registerEqaCase(f.db,lab,card(unit,1),f.lookupKey,{store:f.store}));
  const e2=await tx(f.db,()=>registerEqaCase(f.db,lab,card(unit,2),f.lookupKey,{store:f.store}));
  const p2=await patient(f,2);
  expect(seq(p1)).toBe(1);
  expect([seq(e1.lnHalos),seq(e2.lnHalos)]).toEqual([900,901]);
  expect(seq(p2)).toBe(2);   // patient numbers 1,2: the EQA took none
  expect(e1.lnHalos).toMatch(/^[0-9]{2}B[0-9]{9}$/);
 }finally{await f.close();}
});

it('typed LN Halos: only the EQA block, a valid date, unused; the database refuses a patient in 900-999',async()=>{
 const f=await inboundFixture();
 try{
  const {unit,lab}=await registrar(f.db);
  const reg=(n:number,lnHalos:string)=>tx(f.db,()=>registerEqaCase(f.db,lab,card(unit,n,{lnHalos}),f.lookupKey,{store:f.store}));
  expect((await reg(10,'26B261103950')).lnHalos).toBe('26B261103950');
  expect(await err(reg(11,'26B261103018'))).toMatch(/EQA_LN_HALOS_RANGE_900_999/);
  expect(await err(reg(12,'26B261103950'))).toMatch(/EQA_LN_HALOS_IN_USE/);
  expect(await err(reg(13,'26B269903951'))).toMatch(/EQA_LN_HALOS_DATE_INVALID|EQA_LN_HALOS_FORMAT/);
  const pCase=await register(f,{ln:'990001017001',hn:'9900006301'});
  const pRound=(await f.db.query<{id:string}>('SELECT current_round_id id FROM nipt_case WHERE id=$1',[pCase])).rows[0].id;
  expect(await err(f.db.query("INSERT INTO specimen_lab_number(round_id,case_id,ln_halos,sequence_date,sequence_value,issued_on,issue_path) VALUES($1,$2,'26B261103955','2026-11-03',955,'NIPT_LOCAL_RECEIPT','RECEIPT_TRIGGER')",[pRound,pCase]))).toMatch(/LN_HALOS_900_PLUS_RESERVED_FOR_EQA/);
 }finally{await f.close();}
});

it('a registered EQA passes the specimen-acceptance gate without anyone pressing accept; a rejection still holds it',async()=>{
 const f=await inboundFixture();
 try{
  const {unit,lab}=await registrar(f.db);
  const e=await tx(f.db,()=>registerEqaCase(f.db,lab,card(unit,20),f.lookupKey,{store:f.store}));
  const gate=async()=>{
   const facts=(await attemptFacts(f.db,'a.case_id=$1 ORDER BY a.overall_ordinal DESC LIMIT 1',[e.caseId]))[0];
   return Object.fromEntries(commonPredicates(commonFacts(facts)).map(p=>[p.code,p]));
  };
  expect((await gate())['BG-02']).toMatchObject({status:'PASS',reason:'EQA_RECEIVED_AND_CHECKED_AT_REGISTRATION'});
  await replica(f,()=>f.db.query("INSERT INTO specimen_acceptance(round_id,identity_checked,label_checked,condition,criteria_reference,reason,actor_id) VALUES($1,true,true,'REJECTED','SYNTHETIC-CRITERIA-REF','SYNTHETIC-REJECTED-TEST',$2)",[e.roundId,lab.id]));
  expect((await gate())['BG-02'].status).not.toBe('PASS');
 }finally{await f.close();}
});

it('deleting an unused EQA removes it, keeps a tombstone and the audit trail, and frees the number and the LN for reuse',async()=>{
 const f=await inboundFixture();
 try{
  const {unit,lab}=await registrar(f.db);
  const e1=await tx(f.db,()=>registerEqaCase(f.db,lab,card(unit,30),f.lookupKey,{store:f.store}));
  const e2=await tx(f.db,()=>registerEqaCase(f.db,lab,card(unit,31),f.lookupKey,{store:f.store}));
  const del=await tx(f.db,()=>deleteEqaRegistration(f.db,lab,{caseId:e2.caseId,reason:'ลงทะเบียนผิด'}));
  expect(del).toEqual({lnHalos:e2.lnHalos,numberReusable:true});
  expect((await f.db.query('SELECT 1 FROM nipt_case WHERE id=$1',[e2.caseId])).rows).toHaveLength(0);
  for(const t of ['case_ln','specimen_round','specimen_lab_number','analytical_attempt','eqa_case','p2_case_identity','registration_attempt','case_unit_scope','p2_workspace'])
   expect((await f.db.query(`SELECT 1 FROM ${t} WHERE case_id=$1`,[e2.caseId])).rows,t).toHaveLength(0);
  expect((await f.db.query('SELECT ln_halos,number_reusable,sample_ref FROM eqa_registration_deleted WHERE case_id=$1',[e2.caseId])).rows).toEqual([{ln_halos:e2.lnHalos,number_reusable:true,sample_ref:'9900006131'}]);
  expect((await f.db.query<{n:number}>("SELECT count(*)::int n FROM audit_chain WHERE action='EQA_REGISTRATION_DELETED' AND resource_id=$1",[e2.caseId])).rows[0].n).toBe(1);
  expect((await f.db.query('SELECT 1 FROM specimen_lab_number WHERE ln_halos=$1',[e1.lnHalos])).rows).toHaveLength(1);   // the other EQA is untouched
  // Reuse: the same LN, the same HN and (as the latest in the block) the same number.
  const again=await tx(f.db,()=>registerEqaCase(f.db,lab,{...card(unit,31),idempotencyKey:'lnh-31b-a1b2c3d4e5f6a7b8c9d0e1f2'},f.lookupKey,{store:f.store}));
  expect(again.lnHalos).toBe(e2.lnHalos);
  await expect(tx(f.db,()=>deleteEqaRegistration(f.db,lab,{caseId:e2.caseId,reason:'ลบซ้ำ'}))).rejects.toThrow(/EQA_NOT_FOUND/);
 }finally{await f.close();}
});

it('delete refuses when anything was built on the EQA, for roles without access, and for a patient case',async()=>{
 const f=await inboundFixture();
 try{
  const {unit,lab,anc}=await registrar(f.db);
  const e=await tx(f.db,()=>registerEqaCase(f.db,lab,card(unit,40),f.lookupKey,{store:f.store}));
  await expect(tx(f.db,()=>deleteEqaRegistration(f.db,anc,{caseId:e.caseId,reason:'ลบงานผิด'}))).rejects.toThrow();
  await replica(f,()=>f.db.query("UPDATE analytical_attempt SET state='Assigned' WHERE case_id=$1",[e.caseId]));   // work started
  await expect(tx(f.db,()=>deleteEqaRegistration(f.db,lab,{caseId:e.caseId,reason:'ลบงานผิด'}))).rejects.toThrow(/EQA_HAS_DOWNSTREAM_WORK/);
  await replica(f,async()=>{
   await f.db.query("UPDATE analytical_attempt SET state='Ready' WHERE case_id=$1",[e.caseId]);
   await f.db.query("INSERT INTO his_inbound_file(sha256,state,case_id) VALUES(repeat('a',64),'Ready',$1)",[e.caseId]);   // a PET now references the case
  });
  await expect(tx(f.db,()=>deleteEqaRegistration(f.db,lab,{caseId:e.caseId,reason:'ลบงานผิด'}))).rejects.toThrow(/EQA_HAS_DOWNSTREAM_WORK/);
  expect((await f.db.query('SELECT 1 FROM eqa_case WHERE case_id=$1',[e.caseId])).rows).toHaveLength(1);   // refused as a whole
  const patientCase=await register(f,{ln:'990001018001',hn:'9900006401'});
  await expect(tx(f.db,()=>deleteEqaRegistration(f.db,lab,{caseId:patientCase,reason:'ลบงานผิด'}))).rejects.toThrow(/EQA_NOT_FOUND/);
 }finally{await f.close();}
});

it('an EQA that took a patient-sequence number earlier gives it back only when it is the latest issued; otherwise it stays a gap',async()=>{
 const f=await inboundFixture();
 try{
  const {unit,lab}=await registrar(f.db);
  expect(seq(await patient(f,1))).toBe(1);
  const month=(await f.db.query<{m:string}>('SELECT sequence_month::text m FROM ln_halos_monthly_sequence')).rows[0].m;
  const legacy=async(value:number,counter:number,n:number)=>{
   const e=await tx(f.db,()=>registerEqaCase(f.db,lab,card(unit,50+n),f.lookupKey,{store:f.store}));
   const date=(await f.db.query<{d:string}>('SELECT sequence_date::text d FROM specimen_lab_number WHERE round_id=$1',[e.roundId])).rows[0].d;
   // Reproduce the earlier release: the number came from the patient sequence.
   await replica(f,async()=>{
    await f.db.query('UPDATE specimen_lab_number SET sequence_value=$3,ln_halos=p4_format_ln_halos($2::date,$3) WHERE round_id=$1',[e.roundId,date,value]);
    await f.db.query('UPDATE ln_halos_monthly_sequence SET last_value=$2 WHERE sequence_month=$1',[month,counter]);
   });
   return e;
  };
  const latest=await legacy(2,2,2);   // monthly counter = 2 = this number
  expect(await tx(f.db,()=>deleteEqaRegistration(f.db,lab,{caseId:latest.caseId,reason:'ลงทะเบียนผิด'}))).toMatchObject({numberReusable:true});
  expect((await f.db.query<{v:number}>('SELECT last_value v FROM ln_halos_monthly_sequence WHERE sequence_month=$1',[month])).rows[0].v).toBe(1);
  expect(seq(await patient(f,3))).toBe(2);   // the next patient reuses the freed number
  const middle=await legacy(3,4,3);   // a later patient exists: counter = 3, this EQA holds 2
  expect(await tx(f.db,()=>deleteEqaRegistration(f.db,lab,{caseId:middle.caseId,reason:'ลงทะเบียนผิด'}))).toMatchObject({numberReusable:false});
  expect((await f.db.query<{v:number}>('SELECT last_value v FROM ln_halos_monthly_sequence WHERE sequence_month=$1',[month])).rows[0].v).toBe(4);
 }finally{await f.close();}
});
