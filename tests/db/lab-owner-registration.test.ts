import {it,expect} from 'vitest';
import {inboundFixture,registrar,writePet,cycle} from '../helpers/inbound';
import {tx} from '../helpers/lab';
import {registerP2} from '../../packages/p2/service';
import {attemptFacts,assignmentDecision} from '../../packages/lab/core';
it('LAB-01/11 records paper markers without fictional signatures or clinical assessment and receives only matched PET',async()=>{
 const f=await inboundFixture();try{
  const u=await registrar(f.db),input={ln:'990001234567',hn:'9900012345',unitId:u.unit,origin:'LAB_DIRECT',idempotencyKey:'lab_owner_registration_001',labOperational:{gaWeeks:17,gaDays:6,edd:'2027-03-24',pregnancy:'Twins',paperRequest:true,paperConsent:true}};
  const r=await tx(f.db,db=>registerP2(db,u.lab,input,f.lookupKey,{store:f.store}));expect(r.caseId).toBeTruthy();
  expect((await f.db.query('SELECT 1 FROM specimen_lab_number WHERE case_id=$1',[r.caseId])).rows).toHaveLength(0);
  expect((await f.db.query('SELECT 1 FROM clinical_snapshot WHERE case_id=$1',[r.caseId])).rows).toHaveLength(0);
  expect((await f.db.query('SELECT 1 FROM p2_document_revision WHERE case_id=$1',[r.caseId])).rows).toHaveLength(0);
  expect((await f.db.query('SELECT request_mode,consent_mode FROM p2_workspace WHERE case_id=$1',[r.caseId])).rows[0]).toEqual({request_mode:'Paper',consent_mode:'Paper'});
  await writePet(f.root,'20261020',{ln:input.ln,hn:input.hn,orderAt:'20261020070809',specimenAt:'20261020080910',receivedAt:'20261020101112'});
  await cycle(f,{now:new Date('2026-10-20T05:00:00Z')});
  const round=(await f.db.query<{received_at:Date;state:string}>('SELECT received_at,state FROM specimen_round WHERE case_id=$1',[r.caseId])).rows[0];
  expect(round.state).toBe('ReceivedInHIS');expect(new Date(round.received_at).toISOString()).toBe('2026-10-20T03:11:12.000Z');
  expect((await f.db.query('SELECT 1 FROM specimen_lab_number WHERE case_id=$1',[r.caseId])).rows).toHaveLength(1);
  const facts=await attemptFacts(f.db,'a.case_id=$1',[r.caseId]);expect(facts[0].pregnancy).toBe('Twins');expect(assignmentDecision(facts[0],'HOLD').eligible).toBe(true);
  const reopened=await tx(f.db,db=>registerP2(db,u.lab,{...input,idempotencyKey:'lab_owner_registration_002'},f.lookupKey,{store:f.store}));expect(reopened.caseId).toBe(r.caseId);
  expect((await f.db.query('SELECT 1 FROM lab_operational_registration WHERE case_id=$1',[r.caseId])).rows).toHaveLength(1);
 }finally{await f.close();}
});
