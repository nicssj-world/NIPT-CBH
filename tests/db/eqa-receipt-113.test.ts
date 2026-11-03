import {it,expect} from 'vitest';
import {inboundFixture,register,registrar} from '../helpers/inbound';
import {tx} from '../helpers/lab';
import {registerEqaCase} from '../../packages/eqa/service';
import {attemptFacts,commonFacts} from '../../packages/lab/core';
import {commonPredicates} from '../../packages/lab/gate';


const card=(unitId:string,o:Partial<Record<string,unknown>>={})=>({
 ln:'990001012001',unitId,idempotencyKey:'eqa-'+Math.random().toString(16).slice(2)+'0000',organizer:'GenQA/EMQN',programYear:2026,
 sampleRef:'9900003001',surname:'POLSON',firstName:'Tonya',dob:'1988-08-23',gaWeeks:11,gaDays:1,collectionDate:'2026-10-19',pregnancy:'Singleton',...o
});
const gate=async(f:Awaited<ReturnType<typeof inboundFixture>>,caseId:string)=>{
 const facts=(await attemptFacts(f.db,'a.case_id=$1 ORDER BY a.overall_ordinal DESC LIMIT 1',[caseId]))[0];
 return {facts,predicates:commonPredicates(commonFacts(facts))};
};

it('registers an EQA card, receives it without PET, issues a genuine LN Halos, and passes the Lab receipt gates',async()=>{
 const f=await inboundFixture();
 try{
  const {unit,lab}=await registrar(f.db);
  const r=await tx(f.db,()=>registerEqaCase(f.db,lab,card(unit),f.lookupKey,{store:f.store}));
  expect(r.lnHalos).toMatch(/^[0-9]{2}B[0-9]{9}$/);
  const round=(await f.db.query<{state:string;received_source:string;collection_date:string}>('SELECT state,received_source,collection_date::text FROM specimen_round WHERE id=$1',[r.roundId])).rows[0];
  expect(round).toEqual({state:'ReceivedInNIPT',received_source:'NIPT_LOCAL_RECEIPT',collection_date:'2026-10-19'});
  expect((await f.db.query('SELECT 1 FROM his_inbound_file WHERE case_id=$1',[r.caseId])).rows).toHaveLength(0);
  const {predicates}=await gate(f,r.caseId);
  const by=Object.fromEntries(predicates.map(p=>[p.code,p]));
  expect(by['BG-01']).toMatchObject({status:'PASS'});
  expect(by['BG-03']).toMatchObject({status:'PASS'});
  expect(by['BG-04']).toMatchObject({status:'PASS',reason:'EQA_NO_PATIENT_CONSENT_APPLICABLE'});
  expect(by['BG-05']).toMatchObject({status:'PASS',reason:'EQA_REFERRAL_CARD'});
  expect(by['BG-06']).toMatchObject({status:'PASS',reason:'EQA_REFERRAL_CARD'});
  expect(by['BG-07']).toMatchObject({status:'PASS'});
  // The classification and identity are immutable and nothing can be queued to HIS.
  // The registration identity stays append-only (owner 2026-11-03 allows only the basic data - name, DOB, GA, collection date, pregnancy, note - to be corrected, until a report exists).
  await expect(f.db.query("UPDATE eqa_case SET sample_ref='X' WHERE case_id=$1",[r.caseId])).rejects.toThrow(/append-only/i);
  await expect(f.db.query("INSERT INTO job_outbox(kind,payload,idempotency_key) VALUES('result_release_completed',$1,'x1')",[JSON.stringify({caseId:r.caseId})])).rejects.toThrow(/EQA_NO_HIS_OUTBOUND/);
 }finally{await f.close();}
});

it('a real patient is unchanged: no PET still means not received, and round-1 local receipt is refused',async()=>{
 const f=await inboundFixture();
 try{
  const caseId=await register(f,{ln:'990001012002',hn:'9900003002',origin:'LAB_DIRECT'});
  const round=(await f.db.query<{id:string}>('SELECT current_round_id id FROM nipt_case WHERE id=$1',[caseId])).rows[0].id;
  await expect(f.db.query("UPDATE specimen_round SET state='ReceivedInNIPT',received_source='NIPT_LOCAL_RECEIPT',received_at=now() WHERE id=$1",[round])).rejects.toThrow(/LOCAL_RECEIPT_ROUND1_EQA_ONLY|round_receipt/i);
  expect((await f.db.query<{state:string}>('SELECT state FROM specimen_round WHERE id=$1',[round])).rows[0].state).not.toBe('ReceivedInNIPT');
 }finally{await f.close();}
});

it('EQA registration refuses a reused LN, a future collection date and a duplicate organizer sample',async()=>{
 const f=await inboundFixture();
 try{
  const {unit,lab}=await registrar(f.db);
  await tx(f.db,()=>registerEqaCase(f.db,lab,card(unit),f.lookupKey,{store:f.store}));
  await expect(tx(f.db,()=>registerEqaCase(f.db,lab,card(unit,{collectionDate:'2999-01-01',ln:'990001012003',sampleRef:'9900003003'}),f.lookupKey,{store:f.store}))).rejects.toThrow();
  await expect(tx(f.db,()=>registerEqaCase(f.db,lab,card(unit,{ln:'990001012004'}),f.lookupKey,{store:f.store}))).rejects.toThrow();
 }finally{await f.close();}
});
