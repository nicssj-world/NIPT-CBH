import {beforeAll,afterAll,describe,it,expect} from "vitest";
import type {PGlite} from "@electric-sql/pglite";
import {testDatabase,addUser} from "../helpers/database";
import {SETTINGS,settingDefinition} from "../../packages/settings/catalog";
import {proposeSetting,validateSetting,approveSetting,activateSetting,rollbackSetting,readActiveSettings,readSettingRevisions} from "../../packages/settings/service";
import type {Principal} from "../../packages/security/policy";
let db:PGlite,admin:Principal,approver:Principal;
describe("settings lifecycle and locked architecture",()=>{
 beforeAll(async()=>{db=await testDatabase();admin=await addUser(db);approver=await addUser(db,"CLINICAL_APPROVER","synthetic.approver");});
 afterAll(async()=>{await db.close();});
 it("all ten categories and independent cutoff are typed, LD is not a toggle",()=>{
  // Task 3 adds report_interpretation (CLINICAL maker-checker) and report_output (GENERAL) to the twelve earlier keys.
  expect(Object.keys(SETTINGS)).toEqual(["general","request_consent","doctor_registry","security","his_inbound","laboratory","result_management","his_outbound","storage_backup","notifications","historical_backfill","report_interpretation","report_output","go_live_cutoff"]);
  expect(()=>settingDefinition("disable_redraw_same_ln")).toThrow();
  expect(SETTINGS.his_outbound.schema.parse({...SETTINGS.his_outbound.default,productionAuthorized:true}).productionAuthorized).toBe(true);
  expect(()=>SETTINGS.his_outbound.schema.parse({...SETTINGS.his_outbound.default,resProfile:{invented:true}})).toThrow();
  expect(()=>SETTINGS.laboratory.schema.parse({...SETTINGS.laboratory.default,halosDataRows:48})).toThrow();
 });
 it("test before activate and rollback produces a new version",async()=>{
  const first=await proposeSetting(db,admin,"general",SETTINGS.general.default,"SYNTHETIC_INITIAL");
  await expect(activateSetting(db,admin,first)).rejects.toThrow();
  expect(await validateSetting(db,admin,first,async()=>false)).toBe(false);
  expect(await validateSetting(db,admin,first,async()=>true)).toBe(true);
  await activateSetting(db,admin,first);
  const second=await proposeSetting(db,admin,"general",{...SETTINGS.general.default,systemName:"ระบบจำลอง"},"SYNTHETIC_CHANGE");
  await validateSetting(db,admin,second,async()=>true);await activateSetting(db,admin,second);
  const rollback=await rollbackSetting(db,admin,first,"SYNTHETIC_ROLLBACK");
  expect(rollback).not.toBe(first);await validateSetting(db,admin,rollback,async()=>true);await activateSetting(db,admin,rollback);
  expect((await readActiveSettings(db)).general).toEqual(SETTINGS.general.default);
  expect((await db.query("SELECT * FROM settings_revision WHERE setting_key='general'")).rows).toHaveLength(3);
 });
 it('unsupported global settings and installation-owned retention cannot be edited by API/service',async()=>{
  for(const key of ['doctor_registry','storage_backup'] as const)await expect(proposeSetting(db,admin,key,SETTINGS[key].default,'UNSUPPORTED_TEST')).rejects.toThrow();
  // request_consent is a clinical setting with a consumer; since the single APP_ADMIN decision (2026-11-01) the administrator may
  // propose it, and approving it still needs a different person.
  const consent=await proposeSetting(db,admin,'request_consent',SETTINGS.request_consent.default,'CLINICAL_TEST');await validateSetting(db,admin,consent,async()=>true);await expect(approveSetting(db,admin,consent)).rejects.toThrow(/FORBIDDEN/);
  await expect(proposeSetting(db,{...approver,roles:['LAB_CERTIFIER']},'laboratory',{...SETTINGS.laboratory.default,formulaVersion:'invented'},'CONTROLLED_TEST')).rejects.toThrow('CONTROLLED_METADATA_READ_ONLY');
 });
 it('always includes actual Active revisions even after more than 100 newer history entries',async()=>{
  const active=(await db.query<{revision_id:string}>("SELECT revision_id FROM setting_active WHERE setting_key='general'")).rows[0].revision_id;
  for(let n=1;n<=101;n++)await db.query("INSERT INTO settings_revision(setting_key,version,category,risk,value,state,created_by,reason) VALUES('notifications',$1,'Notifications/System/Audit','GENERAL',$2,'Archived',$3,'HISTORY_TEST')",[n,SETTINGS.notifications.default,admin.id]);
  const revisions=await readSettingRevisions(db);expect(revisions.some(r=>r.id===active&&r.state==='Active')).toBe(true);expect(revisions.length).toBeGreaterThan(100);
 });
 it("production authorisation of HIS outbound still needs a checker, direct DB activation fails without approval (other system configuration is the administrator's alone, see admin-direct-settings)",async()=>{
  const production={...SETTINGS.his_outbound.default,productionAuthorized:true};
  const id=await proposeSetting(db,admin,"his_outbound",production,"SYNTHETIC_INTEGRATION");
  await validateSetting(db,admin,id,async()=>true);
  await expect(db.query("INSERT INTO setting_active(setting_key,revision_id) VALUES('his_outbound',$1)",[id])).rejects.toThrow(/APPROVAL/);
  await expect(approveSetting(db,{...approver,id:admin.id},id)).rejects.toThrow(/FORBIDDEN/);
  await approveSetting(db,approver,id);await activateSetting(db,approver,id);
  expect((await readActiveSettings(db)).his_outbound).toEqual(production);
  await expect(db.query("UPDATE settings_revision SET value='{}' WHERE id=$1",[id])).rejects.toThrow(/IMMUTABLE/);
 });
});
