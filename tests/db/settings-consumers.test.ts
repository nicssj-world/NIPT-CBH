import {it,expect,describe,beforeAll,afterAll,vi} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {ZodError} from 'zod';
import {testDatabase,addUser} from '../helpers/database';
import {setPendingPolicy} from '../helpers/lab';
import {resultFixture,receivedCase} from '../helpers/results';
import type {Principal} from '../../packages/security/policy';
import {SETTINGS} from '../../packages/settings/catalog';
import {SETTING_FORMS} from '../../packages/settings/fields';
import {proposeSetting,validateSetting,activateSetting,rollbackSetting,readActiveSettings} from '../../packages/settings/service';
import {IDLE_MS,ABSOLUTE_MS,LOCKOUT_MS,LOCKOUT_ATTEMPTS} from '../../packages/security/session';
import {crossCheck} from '../../packages/results/service';
import {buildSyntheticPet,redactPet} from '../../packages/inbound/wire';
import {parsePet} from '../../packages/integrations/pet';
import {settingsErrorMessage,SETTINGS_MESSAGES} from '../../src/server/settings-errors';

// Settings acceptance (2026-10-18): each remaining category through Save → Validate → Activate → the code that reads it → a visible
// effect. Inbound/result-folder/outbound are proven with the NIPTY_handover.zip samples in settings-zip-simulation.test.ts.
let db:PGlite,admin:Principal,staff:Principal;
beforeAll(async()=>{db=await testDatabase();admin=await addUser(db);staff=await addUser(db,'LAB_STAFF','consumer.staff');});
afterAll(async()=>{await db.close();vi.unstubAllEnvs();});
const general=async(value:unknown,reason='Settings consumer test')=>{const id=await proposeSetting(db,admin,'general',value,reason);await validateSetting(db,admin,id,async()=>true);await activateSetting(db,admin,id);return id;};

describe('Settings → consumer',()=>{
 it('1 General: the active name is what the protected layout reads; invalid values, permission and rollback',async()=>{
  const first=await general({systemName:'NIPT CBH ห้องปฏิบัติการ',timezone:'Asia/Bangkok'});
  // src/app/(protected)/layout.tsx: SETTINGS.general.schema.parse(active.general ?? default).systemName → Sidebar
  expect(SETTINGS.general.schema.parse((await readActiveSettings(db)).general).systemName).toBe('NIPT CBH ห้องปฏิบัติการ');
  const tooLong=await proposeSetting(db,admin,'general',{systemName:'ก'.repeat(81),timezone:'Asia/Bangkok'},'Too long').catch(e=>e);
  expect(tooLong).toBeInstanceOf(ZodError);expect(settingsErrorMessage(tooLong,'general')).toContain('ชื่อระบบ');
  await expect(proposeSetting(db,admin,'general',{systemName:'X',timezone:'UTC'},'Timezone is locked')).rejects.toBeInstanceOf(ZodError);
  await expect(proposeSetting(db,staff,'general',{systemName:'X',timezone:'Asia/Bangkok'},'No permission')).rejects.toThrow('FORBIDDEN');
  await general({systemName:'ชื่อชั่วคราว',timezone:'Asia/Bangkok'});
  const back=await rollbackSetting(db,admin,first,'Return to the previous name');await validateSetting(db,admin,back,async()=>true);await activateSetting(db,admin,back);
  expect(SETTINGS.general.schema.parse((await readActiveSettings(db)).general).systemName).toBe('NIPT CBH ห้องปฏิบัติการ');
 });
 it('4 Security: the locked literals are exactly the values the session code enforces; other values are refused',async()=>{
  const s=SETTINGS.security.default;
  expect({idle:IDLE_MS,absolute:ABSOLUTE_MS,lockout:LOCKOUT_MS,attempts:LOCKOUT_ATTEMPTS}).toEqual({idle:s.idleMinutes*60_000,absolute:s.absoluteHours*3_600_000,lockout:s.lockoutMinutes*60_000,attempts:s.lockoutAttempts});
  const e=await proposeSetting(db,admin,'security',{...s,idleMinutes:60},'Not allowed').catch(x=>x);expect(e).toBeInstanceOf(ZodError);
  expect(SETTING_FORMS.security.fields.every(f=>f.kind==='locked')).toBe(true);
 });
 it('2/3/9 request_consent, doctor_registry version and storage_backup have no runtime consumer: read-only and refused with a clear reason',async()=>{
  // request_consent now has a consumer (ANC form preview, tests/db/anc-forms.test.ts); it is a clinical setting, proposed by a certifier.
  await expect(proposeSetting(db,admin,'request_consent',SETTINGS.request_consent.default,'Clinical setting')).rejects.toThrow('FORBIDDEN');
  await expect(proposeSetting(db,admin,'doctor_registry',SETTINGS.doctor_registry.default,'No consumer')).rejects.toThrow('SETTING_RUNTIME_CONSUMER_UNAVAILABLE');
  await expect(proposeSetting(db,admin,'storage_backup',SETTINGS.storage_backup.default,'Installation owned')).rejects.toThrow('INSTALLATION_OWNED_SETTING');
 });
 it('10 Notifications: active thresholds are used by the Health calculator; out-of-range values are refused',async()=>{
  const id=await proposeSetting(db,admin,'notifications',{staleSeconds:60,backlogWarning:1},'Tighter alert thresholds');await validateSetting(db,admin,id,async()=>true);await activateSetting(db,admin,id);
  vi.stubEnv('NIPT_MODE','synthetic');
  const {systemHealth}=await import('../../src/server/health');
  const h=await systemHealth(db as never,'synthetic',{status:'ALIVE'} as never) as {thresholds?:unknown};
  expect(h.thresholds).toEqual({staleSeconds:60,backlogWarning:1});
  const bad=await proposeSetting(db,admin,'notifications',{staleSeconds:30,backlogWarning:1},'Too short').catch(e=>e);
  expect(settingsErrorMessage(bad,'notifications')).toContain('ถือว่า Worker ขาดการติดต่อเมื่อเกิน');
 });
 it('6 Laboratory: pendingGovernanceGate decides whether a received sample is READY or GATE_BLOCKED in the worklist',async()=>{
  const f=await resultFixture();try{
   const c=await receivedCase(f);const {labWorklist}=await import('../../packages/lab/intake');
   const category=async()=>((await labWorklist(f.db,{...f.u.staff,unitIds:[f.u.unit]} as never) as {attempts:{caseId:string;category:string}[]}).attempts.find(a=>a.caseId===c.caseId)!.category);
   await setPendingPolicy(f.db,f.u,'HOLD');expect(await category()).toBe('GATE_BLOCKED');
   await setPendingPolicy(f.db,f.u,'PROCEED_SYNTHETIC_LABELLED');expect(await category()).toBe('READY');
   await setPendingPolicy(f.db,f.u,'HOLD');expect(await category()).toBe('GATE_BLOCKED');
   // Template/formula versions are controlled metadata: a direct change is refused.
   await expect(proposeSetting(f.db,f.u.certifier,'laboratory',{...SETTINGS.laboratory.default,templateVersion:'other'},'Not editable')).rejects.toThrow('CONTROLLED_METADATA_READ_ONLY');
  }finally{await f.close();}
 });
 it('7 Result management gaToleranceDays: the GA cross-check (RG-04) follows the active tolerance',()=>{
  const parsed={identifiers:{hn:{value:'990000000001'},dob:{value:'1996-03-31'},labNumber:{value:null},collectionDate:{value:'2026-10-10'},gestationalAgeDays:{value:90}},templateKind:'SINGLETON'} as never;
  const req={dates:['2026-10-10'],edd:'2027-04-22',pregnancy:'Singleton',dob:'1996-03-31'} as never,sys={hn:'990000000001',printed_sample_id:null,ln_halos:null,ln:'1'};
  // EDD → GA 86 days on the collection date; the report says 90.
  expect(crossCheck(parsed,sys,req,7).gestationalAge).toBe('MATCH');expect(crossCheck(parsed,sys,req,3).gestationalAge).toBe('MISMATCH');
 });
 it('Settings errors name what to fix (not one generic message)',()=>{
  for(const code of ['SETTING_APPROVAL_REQUIRED','SETTING_NOT_VALIDATED','SETTING_DRAFT_REQUIRED','REASON_REQUIRED','HIS_MIXED_DESTINATIONS_PROHIBITED','PREVIOUS_ACTIVE_REVISION_REQUIRED'])
   expect(settingsErrorMessage(new Error(code))).toBe(SETTINGS_MESSAGES[code]);
  expect(settingsErrorMessage(new Error('FORBIDDEN'))).toBeNull(); // stays a 403 from apiError
  const zod=(()=>{try{SETTINGS.his_inbound.schema.parse({...SETTINGS.his_inbound.default,intervalSeconds:1,lookbackDays:200});}catch(e){return e;}})();
  expect(settingsErrorMessage(zod,'his_inbound')).toMatch(/รอบการสแกน.*สแกนย้อนหลัง/);
 });
 it('5 HIS PET with an empty citizen ID (legacy test_empty_citizen_id_ok) parses in operational mode; a present ID is still validated',()=>{
  vi.stubEnv('NIPT_MODE','operational');vi.stubEnv('APP_ORIGIN','https://nipt.test');
  try{
   const empty=buildSyntheticPet({ln:'2622370099',hn:'69039999',name:'ไม่มีเลขบัตร^^น.ส. ทดสอบ',receivedAt:'20260811091500',ward:'301',identity:''});
   const pet=parsePet(empty.bytes,empty.filename);expect(pet.identity).toBe('');expect(redactPet(pet,Buffer.alloc(32,7)).identityKey).toBeNull();
   const bad=buildSyntheticPet({ln:'2622370098',hn:'69039998',name:'ทดสอบ^^น.ส. ทดสอบ',receivedAt:'20260811091500',ward:'301',identity:'has space'});
   expect(()=>parsePet(bad.bytes,bad.filename)).toThrow('INVALID_PATIENT_IDENTITY');
  }finally{vi.unstubAllEnvs();}
 });
});
