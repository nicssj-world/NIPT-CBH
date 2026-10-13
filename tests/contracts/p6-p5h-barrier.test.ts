import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase} from '../helpers/database';
import {registerFixture,reserveFixture} from '../../packages/p6/journal';
import {runTransfer} from '../../packages/p6/worker';
import {readClinicalOutboundCandidate} from '../../packages/p6/release-boundary';
import {assertOutboundOrigin,HISTORICAL_OUTBOUND_PROHIBITED} from '../../packages/historical/barrier';
import {fixture} from '../helpers/p6-fixture';

// P5H historical cases must never reach P6: not into the queue (fixture registration / reservation) and not into publication (worker run).
describe('historical origin is blocked at every real P6 boundary',()=>{
 let db:PGlite;beforeAll(async()=>{db=await testDatabase();});afterAll(async()=>{await db.close();});
 it('origin guard accepts only ANC / LAB_DIRECT',()=>{
  expect(()=>assertOutboundOrigin('ANC')).not.toThrow();expect(()=>assertOutboundOrigin('LAB_DIRECT')).not.toThrow();
  expect(()=>assertOutboundOrigin('HISTORICAL')).toThrow(HISTORICAL_OUTBOUND_PROHIBITED);
  for(const v of ['historical','',null,undefined,1])expect(()=>assertOutboundOrigin(v)).toThrow('UNKNOWN_ORIGIN');
 });
 it('queue: a historical fixture cannot be registered, inserted or reserved',async()=>{
  const bad={...fixture(41),origin:'HISTORICAL'} as never;
  await expect(registerFixture(db,bad,'SYNTHETIC-SESSION-9')).rejects.toThrow(HISTORICAL_OUTBOUND_PROHIBITED);
  await expect(db.query("INSERT INTO p6_fixture(id,sandbox_id,draft,draft_hash) VALUES('SYNTHETIC-RAW-1','SYNTHETIC-S',$1,repeat('a',64))",[JSON.stringify({fixtureId:'SYNTHETIC-RAW-1',origin:'HISTORICAL'})])).rejects.toThrow();
  expect((await db.query('SELECT count(*)::int n FROM p6_fixture')).rows[0]).toEqual({n:0});
  expect((await db.query('SELECT count(*)::int n FROM p6_transfer')).rows[0]).toEqual({n:0});
 });
 it('publication: even a transfer row forged to HISTORICAL (guard trigger disabled by the owner) is refused before any file is touched',async()=>{
  await registerFixture(db,fixture(42),'SYNTHETIC-SESSION-9');
  const t=await reserveFixture(db,fixture(42).fixtureId);
  await db.query('ALTER TABLE p6_transfer DISABLE TRIGGER p6_transfer_guard');
  await db.query("UPDATE p6_transfer SET plan=jsonb_set(plan,'{origin}','\"HISTORICAL\"'),model=jsonb_set(model,'{plan,origin}','\"HISTORICAL\"') WHERE id=$1",[t.id]);
  await db.query('ALTER TABLE p6_transfer ENABLE TRIGGER p6_transfer_guard');
  const prior=process.env.NIPT_P6_SANDBOX_ENABLED,mode=process.env.NIPT_MODE;process.env.NIPT_P6_SANDBOX_ENABLED='yes';process.env.NIPT_MODE='synthetic';
  try{await expect(runTransfer(db,t.id)).rejects.toThrow(HISTORICAL_OUTBOUND_PROHIBITED);}finally{if(mode===undefined)delete process.env.NIPT_MODE;else process.env.NIPT_MODE=mode;if(prior===undefined)delete process.env.NIPT_P6_SANDBOX_ENABLED;else process.env.NIPT_P6_SANDBOX_ENABLED=prior;}
  expect((await db.query<{s:string}>("SELECT model->>'state' s FROM p6_transfer WHERE id=$1",[t.id])).rows[0].s).toBe('PREPARED');
 });
 it('clinical publisher stays on hold (RELEASE_HOLD_AL5 untouched)',async()=>{
  await expect(readClinicalOutboundCandidate(db,'00000000-0000-4000-8000-000000000001')).rejects.toThrow('P6_CLINICAL_RELEASE_HOLD_AL5');
  expect((await db.query<{a:boolean}>('SELECT p5_release_authorized() a')).rows[0].a).toBe(false);
 });
});
