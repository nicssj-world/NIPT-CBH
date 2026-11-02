import {it,expect} from 'vitest';
import {inboundFixture,register,registrar,writePet,cycle} from '../helpers/inbound';
import {tx} from '../helpers/lab';
import {orderRedraw} from '../../packages/lab/intake';
import {readCasePetEvidence} from '../../packages/inbound/case-pet-evidence';

const day=(d:string)=>new Date(d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6,8)+'T05:00:00Z');

it('counts scan-independent PET evidence per case: files, distinct contents, resends, verified receipts and rounds',async()=>{
 const f=await inboundFixture();
 try{
  const ln='990001011001',hn='9900001101',caseId=await register(f,{ln,hn}),{lab}=await registrar(f.db);
  const before=await readCasePetEvidence(f.db,caseId);
  expect(before.evidence).toBe('NONE');
  expect(before.counts).toMatchObject({petFiles:0,verifiedHisReceipts:0,specimenRounds:1});

  await writePet(f.root,'20261101',{ln,hn,receivedAt:'20261101090000',specimenAt:'20261101080000'});
  await cycle(f,{now:day('20261101')});
  // Identical content re-sent on another day: recorded, never a second version or receipt.
  await writePet(f.root,'20261102',{ln,hn,receivedAt:'20261101090000',specimenAt:'20261101080000'});
  await cycle(f,{now:day('20261102')});
  const s1=await readCasePetEvidence(f.db,caseId);
  expect(s1.counts.verifiedHisReceipts).toBe(1);
  expect(s1.counts.specimenRounds).toBe(1);
  expect(s1.counts).toEqual({petFiles:1,distinctContents:1,resendSightings:1,verifiedHisReceipts:1,specimenRounds:1});
  expect(s1.scanExecutions).toBe('NOT_ATTRIBUTABLE_TO_CASE');

  // Redraw (new physical specimen) with its own PET raises rounds and receipts, not "scans".
  await tx(f.db,db=>orderRedraw(db,lab,{caseId,reasonCode:'QC1_FAILED',note:'SYNTHETIC new specimen S2'}));
  await writePet(f.root,'20261103',{ln,hn,receivedAt:'20261103090000',specimenAt:'20261103080000'});
  await cycle(f,{now:day('20261103')});
  const s2=await readCasePetEvidence(f.db,caseId);
  expect(s2.counts.specimenRounds).toBe(2);
  expect(s2.counts.verifiedHisReceipts).toBe(2);
  expect(s2.rounds.map(r=>r.roundNumber)).toEqual([1,2]);
  expect(s2.rounds.every(r=>r.verifiedHisReceipt)).toBe(true);
  expect(s2.counts).toMatchObject({petFiles:2,distinctContents:2,verifiedHisReceipts:2,specimenRounds:2});
  expect(s2.rounds.map(r=>r.files)).toEqual([1,1]);
  // Raw scan history is untouched: reading evidence never writes, and the immutable trigger still blocks deletes.
  await expect(f.db.query('DELETE FROM his_inbound_scan_run')).rejects.toThrow(/append-only/i);
  const text=JSON.stringify(s2);
  expect(text).not.toContain(hn);
  expect(text).not.toContain(f.root);
 }finally{await f.close();}
});

it('another patient reusing the LN is not shown in this case evidence',async()=>{
 const f=await inboundFixture();
 try{
  const a=await register(f,{ln:'990001011002',hn:'9900001102'}),b=await register(f,{ln:'990001011003',hn:'9900001103'});
  await writePet(f.root,'20261101',{ln:'990001011003',hn:'9900001103',receivedAt:'20261101090000',specimenAt:'20261101080000'});
  await cycle(f,{now:day('20261101')});
  expect((await readCasePetEvidence(f.db,a)).counts.petFiles).toBe(0);
  expect((await readCasePetEvidence(f.db,b)).counts.petFiles).toBe(1);
 }finally{await f.close();}
});
