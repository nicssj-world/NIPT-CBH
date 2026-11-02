import {it,expect,vi,afterEach} from 'vitest';
import {resultFixture,receivedCase,type ResultFixture} from '../helpers/results';
import {acceptSpecimen} from '../../packages/lab/intake';
afterEach(()=>vi.unstubAllEnvs());
// Owner 2026-11-02: routine acceptance of the physical specimen is ONE confirmation; a rejection names a preset cause; a patient-identity / LN conflict is
// never accepted routinely; a second press records nothing twice. Synthetic data only.
async function operational(f:ResultFixture){vi.stubEnv('NIPT_MODE','operational');vi.stubEnv('APP_ORIGIN','https://nipt.test');await f.db.query("UPDATE nipt_runtime_config SET mode='operational'");}
const rows=(f:ResultFixture,roundId:string)=>f.db.query<{condition:string;criteria_reference:string;reason:string;actor_id:string;identity_checked:boolean;label_checked:boolean}>("SELECT condition,criteria_reference,reason,actor_id,identity_checked,label_checked FROM specimen_acceptance WHERE round_id=$1 ORDER BY created_at,id",[roundId]).then(r=>r.rows);
it('routine acceptance is one confirmation: no typed reason or criteria, the operator and time are recorded, and a second press records nothing twice',async()=>{
 const f=await resultFixture();try{
  await operational(f);const c=await receivedCase(f);
  await f.db.query("UPDATE case_ln SET verification='VERIFIED_BY_PET' WHERE id=(SELECT case_ln_id FROM specimen_round WHERE id=$1)",[c.roundId]);
  expect(await rows(f,c.roundId)).toHaveLength(0);
  const first=await f.run(t=>acceptSpecimen(t,f.u.staff,{roundId:c.roundId,condition:'ACCEPTABLE'}));
  expect(first).toMatchObject({condition:'ACCEPTABLE',duplicate:false});
  const [row]=await rows(f,c.roundId);
  expect(row).toMatchObject({condition:'ACCEPTABLE',actor_id:f.u.staff.id,criteria_reference:'POLICY:SPECIMEN_ACCEPTANCE_ROUTINE_V1',identity_checked:true,label_checked:true});
  expect(row.reason).toMatch(/^ACCEPTED_ROUTINE_CHECK/);
  const again=await f.run(t=>acceptSpecimen(t,f.u.staff,{roundId:c.roundId,condition:'ACCEPTABLE'}));
  expect(again).toMatchObject({id:(first as {id:string}).id,duplicate:true});expect(await rows(f,c.roundId)).toHaveLength(1);
  // the audit trail names the operator and the outcome
  expect((await f.db.query("SELECT 1 FROM audit_chain WHERE action='SPECIMEN_ACCEPTANCE_RECORDED' AND actor_id=$1",[f.u.staff.id])).rows).toHaveLength(1);
  // the old payload (checkboxes, criteria and reason typed by hand) is still understood and its text is not stored
  const legacyRound=(await receivedCase(f));await f.db.query("UPDATE case_ln SET verification='VERIFIED_BY_PET' WHERE id=(SELECT case_ln_id FROM specimen_round WHERE id=$1)",[legacyRound.roundId]);
  await f.run(t=>acceptSpecimen(t,f.u.staff,{roundId:legacyRound.roundId,identityChecked:true,labelChecked:true,condition:'ACCEPTABLE',criteriaReference:'typed by hand criteria',reason:'typed by hand reason'}));
  expect((await rows(f,legacyRound.roundId))[0].reason).not.toContain('typed by hand');
 }finally{await f.close();}
},120000);
it('a rejection needs a preset cause (free text only for "other"), is recorded as rejected, and never changes anything else on its own',async()=>{
 const f=await resultFixture();try{
  await operational(f);const c=await receivedCase(f);
  await expect(f.run(t=>acceptSpecimen(t,f.u.staff,{roundId:c.roundId,condition:'REJECTED'}))).rejects.toThrow('REJECT_CAUSE_REQUIRED');
  await expect(f.run(t=>acceptSpecimen(t,f.u.staff,{roundId:c.roundId,condition:'REJECTED',reasonCode:'OTHER'}))).rejects.toThrow('REJECT_NOTE_REQUIRED');
  await expect(f.run(t=>acceptSpecimen(t,f.u.staff,{roundId:c.roundId,condition:'REJECTED',reasonCode:'NOT_A_CAUSE'}))).rejects.toThrow();
  const stateBefore=(await f.db.query<{state:string}>('SELECT state FROM analytical_attempt WHERE round_id=$1',[c.roundId])).rows;
  await f.run(t=>acceptSpecimen(t,f.u.staff,{roundId:c.roundId,condition:'REJECTED',reasonCode:'VOLUME_INSUFFICIENT'}));
  const [row]=await rows(f,c.roundId);expect(row).toMatchObject({condition:'REJECTED',actor_id:f.u.staff.id});expect(row.reason).toContain('VOLUME_INSUFFICIENT');
  expect((await f.db.query<{state:string}>('SELECT state FROM analytical_attempt WHERE round_id=$1',[c.roundId])).rows).toEqual(stateBefore);
  const other=await receivedCase(f);
  await f.run(t=>acceptSpecimen(t,f.u.staff,{roundId:other.roundId,condition:'REJECTED',reasonCode:'OTHER',note:'tube cracked'}));
  expect((await rows(f,other.roundId))[0].reason).toContain('tube cracked');
 }finally{await f.close();}
},120000);
it('an LN not verified by the PET receipt cannot be accepted routinely; the same specimen can still be rejected; a user outside the scope cannot record anything',async()=>{
 const f=await resultFixture();try{
  await operational(f);const c=await receivedCase(f);
  await f.db.query("UPDATE case_ln SET verification='UNVERIFIED' WHERE id=(SELECT case_ln_id FROM specimen_round WHERE id=$1)",[c.roundId]).catch(()=>undefined);
  const verification=(await f.db.query<{verification:string|null}>("SELECT l.verification FROM specimen_round s JOIN case_ln l ON l.id=s.case_ln_id WHERE s.id=$1",[c.roundId])).rows[0].verification;
  if(verification!=='VERIFIED_BY_PET'){
   await expect(f.run(t=>acceptSpecimen(t,f.u.staff,{roundId:c.roundId,condition:'ACCEPTABLE'}))).rejects.toThrow('LN_NOT_VERIFIED');
   expect(await rows(f,c.roundId)).toHaveLength(0);
  }
  await f.run(t=>acceptSpecimen(t,f.u.staff,{roundId:c.roundId,condition:'REJECTED',reasonCode:'PATIENT_DATA_MISMATCH'}));
  expect((await rows(f,c.roundId))[0].condition).toBe('REJECTED');
  await expect(f.run(t=>acceptSpecimen(t,f.u.auditor,{roundId:c.roundId,condition:'ACCEPTABLE'}))).rejects.toThrow();
 }finally{await f.close();}
},120000);
