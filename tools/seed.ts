import {readFile} from "node:fs/promises";
import {pool,withTransaction} from "../packages/db/connection";
import {hashPassword} from "../packages/security/password";
import {identityLookup} from "../packages/security/envelope";
import {registerCase} from "../packages/db/registration";
import {appendAudit} from "../packages/db/audit";
const password=process.env.SYNTHETIC_SEED_PASSWORD??(process.env.SYNTHETIC_SEED_PASSWORD_FILE?(await readFile(process.env.SYNTHETIC_SEED_PASSWORD_FILE,"utf8")).trim():"");
if(!password)throw new Error("SYNTHETIC_SEED_PASSWORD_REQUIRED");
const hash=await hashPassword(password),lookupKey=await readFile(process.env.IDENTITY_LOOKUP_KEY_FILE??"");
await withTransaction(async db=>{
 const names=[["admin","APP_ADMIN"],["approver","CLINICAL_APPROVER"],["lab","LAB_STAFF"],["anc","ANC_NURSE"],["auditor","AUDITOR"]];const ids:Record<string,string>={};
 for(const [name,role] of names){const r=await db.query<{id:string}>("INSERT INTO app_user(username,display_name,password_hash) VALUES($1,$2,$3) ON CONFLICT(username) DO UPDATE SET username=excluded.username RETURNING id",[`synthetic.${name}`,`ผู้ใช้จำลอง ${name}`,hash]);ids[name]=r.rows[0].id;await db.query("INSERT INTO role_assignment(user_id,role) VALUES($1,$2) ON CONFLICT DO NOTHING",[ids[name],role]);}
 const unit=(await db.query<{id:string}>("INSERT INTO unit(code,name) VALUES('SYNTHETIC_ANC','หน่วย ANC จำลอง') ON CONFLICT(code) DO UPDATE SET code=excluded.code RETURNING id")).rows[0].id;
 await db.query("INSERT INTO user_unit_scope(user_id,unit_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[ids.anc,unit]);
 for(let i=1;i<=3;i++){const result=await registerCase(db,{ln:`99000${String(i).padStart(7,"0")}`,identityKey:identityLookup(`SYNTHETIC-ID-${i}`,lookupKey),origin:i===3?"LAB_DIRECT":"ANC",actorId:ids.lab,idempotencyKey:`synthetic_seed_case_${i}`});if(result.caseId)await db.query("INSERT INTO case_unit_scope(case_id,unit_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[result.caseId,unit]);}
 await appendAudit(db,{actorId:ids.admin,action:"SYNTHETIC_SEED",resourceType:"SYSTEM",details:{count:3,synthetic:true}});
});await pool().end();process.stdout.write("Synthetic accounts and three foundation cases prepared. No password printed.\n");
