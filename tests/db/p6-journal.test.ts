import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase} from '../helpers/database';
import {registerFixture,reserveFixture,loadTransfer,applyEvent,readHistory} from '../../packages/p6/journal';
import {readClinicalOutboundCandidate} from '../../packages/p6/release-boundary';
import {fixture} from '../helpers/p6-fixture';

export {fixture};
describe('P6 durable journal on isolated PostgreSQL-compatible DB',()=>{
  let db:PGlite;
  beforeAll(async()=>{db=await testDatabase();});afterAll(async()=>{await db.close();});
  it('registers an immutable fixture, reserves once, reuses exact plan/N and stores no clinical release',async()=>{
    await registerFixture(db,fixture(1),'SYNTHETIC-SESSION-1');
    const a=await reserveFixture(db,fixture(1).fixtureId),b=await reserveFixture(db,fixture(1).fixtureId);
    expect(b.id).toBe(a.id);expect(a.plan.sequence).toBe(1);expect(a.model.state).toBe('PREPARED');
    expect((await db.query('SELECT * FROM result_release')).rows).toHaveLength(0);
    expect((await db.query<{allowed:boolean}>('SELECT p5_release_authorized() allowed')).rows[0].allowed).toBe(false);
    for(const sql of ["UPDATE p6_fixture SET sandbox_id='SYNTHETIC-OTHER'",'DELETE FROM p6_fixture',"UPDATE p6_transfer SET plan='{}'",'DELETE FROM p6_transfer','DELETE FROM p6_transfer_event'])await expect(db.query(sql)).rejects.toThrow();
  });
  it('appends durable step evidence and rejects stale checkpoint/replayed changed proof',async()=>{
    await registerFixture(db,fixture(2),'SYNTHETIC-SESSION-1');const a=await reserveFixture(db,fixture(2).fixtureId,0);
    const b=await applyEvent(db,a.id,{type:'PDF_VERIFIED',sha256:a.plan.pdfHash},a.revision,1);
    expect(b.model.state).toBe('PDF_VERIFIED');expect((await loadTransfer(db,a.id)).model.state).toBe('PDF_VERIFIED');
    await expect(applyEvent(db,a.id,{type:'RES_VERIFIED',sha256:a.plan.resHash},a.revision,2)).rejects.toThrow('STALE_TRANSFER');
    expect((await readHistory(db,a.id)).events).toHaveLength(2);
    await expect(db.query("UPDATE p6_transfer_event SET code='EDITED'")).rejects.toThrow();
  });
  it('keeps report revision sequence across rounds and detects immutable filename collisions',async()=>{
    const d=fixture(3);await registerFixture(db,d,'SYNTHETIC-SESSION-1');await reserveFixture(db,d.fixtureId);
    const revision={...d,fixtureId:'SYNTHETIC-REVISION-3',reportVersionId:'SYNTHETIC-VERSION-REVISION-3',input:{...d.input,generatedAt:'20261011123556'}};
    await registerFixture(db,revision,'SYNTHETIC-SESSION-1');expect((await reserveFixture(db,revision.fixtureId)).plan.sequence).toBe(2);
    const collision={...d,fixtureId:'SYNTHETIC-COLLISION-3',reportVersionId:'SYNTHETIC-VERSION-COLLISION-3'};
    await registerFixture(db,collision,'SYNTHETIC-SESSION-1');await expect(reserveFixture(db,collision.fixtureId)).rejects.toThrow('DESTINATION_COLLISION');
  });
  it('queries actual P5 clinical authority and never falls back to a fixture',async()=>{
    await expect(readClinicalOutboundCandidate(db,'00000000-0000-4000-8000-000000000001')).rejects.toThrow('P6_CLINICAL_RELEASE_HOLD_AL5');
    await expect(readClinicalOutboundCandidate({query:async()=>{throw Error('unavailable');}},'00000000-0000-4000-8000-000000000001')).rejects.toThrow('P6_RELEASE_AUTHORITY_UNAVAILABLE');
    expect((await db.query('SELECT * FROM result_release')).rows).toHaveLength(0);
  });
  it('test-only authority stubs cannot reinterpret ANC-view or unknown channels as outbound approval',async()=>{
    const candidate=async(release:Record<string,unknown>|undefined)=>readClinicalOutboundCandidate({query:async<T>(sql:string)=>({rows:(sql.includes('p5_release_authorized')?[{authorized:true}]:release?[release]:[]) as T[]})},'00000000-0000-4000-8000-000000000001');
    await expect(candidate({state:'Active',channel:'NIPT_ANC_VIEW'})).rejects.toThrow('P6_ANC_VIEW_IS_NOT_OUTBOUND_AUTHORITY');
    await expect(candidate({state:'Active',channel:'HIS'})).rejects.toThrow('P6_OUTBOUND_CONTRACT_HOLD_AL6');
    await expect(candidate(undefined)).rejects.toThrow('P6_ACTIVE_RELEASE_REQUIRED');
  });
});
