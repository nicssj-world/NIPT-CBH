import {it,expect} from 'vitest';
import {inboundFixture,registrar} from '../helpers/inbound';
import {tx} from '../helpers/lab';
import {registerP2} from '../../packages/p2/service';
import {buildSyntheticPet,redactPet} from '../../packages/inbound/wire';
import {parsePet} from '../../packages/integrations/pet';
import {applyS1} from '../../packages/inbound/process';
import {correctLegacyPetClocks} from '../../packages/inbound/clock-correction';
it('LAB-11 corrects current S1 clocks from raw PET with immutable prior lineage and no LN Halos renumbering',async()=>{
 const f=await inboundFixture();try{
  const u=await registrar(f.db),ln='990001234567',hn='9900012345';
  const r=await tx(f.db,db=>registerP2(db,u.lab,{ln,hn,unitId:u.unit,origin:'LAB_DIRECT',identifierSource:'TUBE_LABEL',idempotencyKey:'lab_old_pet_clock_fixture'},f.lookupKey,{store:f.store}));
  const fixture=buildSyntheticPet({ln,hn,orderAt:'20261020000100',specimenAt:'20261020000200',receivedAt:'20261020000300'}),current=parsePet(fixture.bytes,fixture.filename);
  // Replay the *old version's* actual parser semantics to establish a migration fixture, not a UAT status shortcut.
  const previous={...current,receivedAt:current.orderAt,orderAt:current.specimenAt},parsed={...redactPet(previous,f.lookupKey),parserVersion:'pet-strict-cp874-v1'};
  await f.store.put(fixture.bytes);
  const file=(await f.db.query<{id:string}>("INSERT INTO his_inbound_file(sha256,state,filename,parsed,ln,parser_version,case_id) VALUES($1,'Ready',$2,$3,$4,'pet-strict-cp874-v1',$5) RETURNING id",[current.hash,fixture.filename,parsed,ln,r.caseId])).rows[0];
  const link=(await f.db.query<{id:string}>('SELECT id FROM case_ln WHERE case_id=$1',[r.caseId])).rows[0];
  await tx(f.db,db=>applyS1(db,file,previous,{case_ln_id:link.id,case_id:r.caseId!,origin:'LAB_DIRECT'},'AUTOMATIC'));
  const labels=(await f.db.query('SELECT * FROM specimen_lab_number')).rows;
  const preview=await tx(f.db,db=>correctLegacyPetClocks(db,f.deps,u.lab.id,'Owner clock correction test fixture',false));expect(preview).toHaveLength(1);
  expect((await f.db.query('SELECT 1 FROM lab_pet_clock_correction')).rows).toHaveLength(0);
  await tx(f.db,db=>correctLegacyPetClocks(db,f.deps,u.lab.id,'Owner clock correction test fixture',true));
  const raw=(await f.db.query<{received_at:Date}>('SELECT received_at FROM specimen_round WHERE case_id=$1',[r.caseId])).rows[0];
  const corrected=(await f.db.query<{received_at:Date}>('SELECT received_at FROM specimen_round_current WHERE case_id=$1',[r.caseId])).rows[0];
  expect(new Date(raw.received_at).toISOString()).toBe('2026-10-19T17:01:00.000Z');expect(new Date(corrected.received_at).toISOString()).toBe('2026-10-19T17:03:00.000Z');
  const order=(await f.db.query<{his_received_at:Date}>('SELECT his_received_at FROM his_order_current')).rows[0];expect(new Date(order.his_received_at).toISOString()).toBe(new Date(corrected.received_at).toISOString());
  expect((await f.db.query<{parsed:unknown}>('SELECT parsed FROM his_inbound_file')).rows[0].parsed).toEqual(parsed);
  expect((await f.db.query<{parsed:{orderAt:string;receivedAt:string}}> ('SELECT parsed FROM his_inbound_file_current')).rows[0].parsed).toMatchObject({orderAt:current.orderAt,receivedAt:current.receivedAt});
  expect((await f.db.query('SELECT * FROM specimen_lab_number')).rows).toEqual(labels);
  expect(await tx(f.db,db=>correctLegacyPetClocks(db,f.deps,u.lab.id,'Owner clock correction idempotence',true))).toHaveLength(0);
  await expect(f.db.query('DELETE FROM lab_pet_clock_correction')).rejects.toThrow();
 }finally{await f.close();}
});
