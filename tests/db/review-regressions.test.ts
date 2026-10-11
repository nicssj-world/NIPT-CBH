import {describe,it,expect} from "vitest";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {PGlite} from "@electric-sql/pglite";
import {testDatabase,addUser,TEST_PASSWORD} from "../helpers/database";
import {registerCase} from "../../packages/db/registration";
import {migrate} from "../../tools/migrate";
import {readFile} from "node:fs/promises";
import {authenticate,readSession} from "../../packages/security/session";
import {proposeSetting,validateSetting,activateSetting} from "../../packages/settings/service";
import {SETTINGS} from "../../packages/settings/catalog";
import {verifyAuditChain} from "../../packages/db/audit";
describe("review regressions",()=>{
 it("received state alone cannot bypass NULL provenance",async()=>{const db=await testDatabase();try{await db.query("BEGIN");const c=await registerCase(db,{ln:"990000009991",identityKey:"a".repeat(64),origin:"ANC",idempotencyKey:"null_receipt_regression"});await db.query("COMMIT");await expect(db.query("UPDATE specimen_round SET state='ReceivedInHIS' WHERE case_id=$1",[c.caseId])).rejects.toThrow();}finally{await db.close();}});
 it("app_rw can authenticate, read session and change general settings; cannot read ciphertext",async()=>{const db=await testDatabase();try{const admin=await addUser(db);await db.exec(await readFile("packages/db/roles.sql","utf8"));await db.query("SET ROLE app_rw");const login=(await authenticate(db,"synthetic.admin",TEST_PASSWORD))!;expect(await readSession(db,login.token)).not.toBeNull();await db.query("BEGIN");const id=await proposeSetting(db,admin,"general",SETTINGS.general.default,"SYNTHETIC_ROLE_SMOKE");await validateSetting(db,admin,id,async()=>true);await activateSetting(db,admin,id);await db.query("COMMIT");const audit=await db.query<{previous_hash:string;hash:string;payload:string}>("SELECT * FROM audit_chain ORDER BY sequence");expect(verifyAuditChain(audit.rows)).toBe(true);expect(audit.rows).toHaveLength(3);await expect(db.query("SELECT ciphertext FROM secret_revision")).rejects.toThrow(/permission/);}finally{await db.close();}});
 it("rejects backdated migration before mutation",async()=>{const dir=await mkdtemp(path.join(tmpdir(),"nipt-migration-"));const db=new PGlite();try{await writeFile(path.join(dir,"002_later.sql"),"CREATE TABLE later (id int);");await migrate(db,dir);await writeFile(path.join(dir,"001_backdated.sql"),"CREATE TABLE must_not_exist(id int);");await expect(migrate(db,dir)).rejects.toThrow(/Backdated/);expect((await db.query("SELECT to_regclass('must_not_exist') AS name")).rows[0]).toEqual({name:null});}finally{await db.close();await rm(dir,{recursive:true,force:true});}});
});
