import {beforeAll,afterAll,describe,it,expect} from "vitest";
import type {PGlite} from "@electric-sql/pglite";
import {testDatabase,addUser} from "../helpers/database";
import {SETTINGS,settingDefinition} from "../../packages/settings/catalog";
import {proposeSetting,validateSetting,approveSetting,activateSetting,rollbackSetting,readActiveSettings} from "../../packages/settings/service";
import type {Principal} from "../../packages/security/policy";
let db:PGlite,admin:Principal,approver:Principal;
describe("settings lifecycle and locked architecture",()=>{
 beforeAll(async()=>{db=await testDatabase();admin=await addUser(db);approver=await addUser(db,"CLINICAL_APPROVER","synthetic.approver");});
 afterAll(async()=>{await db.close();});
 it("all ten categories and independent cutoff are typed, LD is not a toggle",()=>{
  expect(Object.keys(SETTINGS)).toHaveLength(11);
  expect(()=>settingDefinition("disable_redraw_same_ln")).toThrow();
  expect(()=>SETTINGS.his_outbound.schema.parse({...SETTINGS.his_outbound.default,productionAuthorized:true})).toThrow();
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
 it("integration needs checker, direct DB activation fails without approval",async()=>{
  const id=await proposeSetting(db,admin,"his_inbound",SETTINGS.his_inbound.default,"SYNTHETIC_INTEGRATION");
  await validateSetting(db,admin,id,async()=>true);
  await expect(db.query("INSERT INTO setting_active(setting_key,revision_id) VALUES('his_inbound',$1)",[id])).rejects.toThrow(/APPROVAL/);
  await expect(approveSetting(db,{...approver,id:admin.id},id)).rejects.toThrow(/FORBIDDEN/);
  await approveSetting(db,approver,id);await activateSetting(db,approver,id);
  expect((await readActiveSettings(db)).his_inbound).toEqual(SETTINGS.his_inbound.default);
  await expect(db.query("UPDATE settings_revision SET value='{}' WHERE id=$1",[id])).rejects.toThrow(/IMMUTABLE/);
 });
});
