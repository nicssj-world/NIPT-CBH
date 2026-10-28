import { PGlite } from "@electric-sql/pglite";
import {fileURLToPath} from "node:url";
import { migrate } from "../../tools/migrate";
import { hashPassword } from "../../packages/security/password";
import type { Principal, Role } from "../../packages/security/policy";
export async function testDatabase() { const db = new PGlite(); await migrate(db,fileURLToPath(new URL("../../db/migrations",import.meta.url))); return db; }
export const TEST_PASSWORD = "Synthetic-Test-Only-48!";
export async function addUser(db: PGlite, role: Role = "APP_ADMIN", username = "synthetic.admin"): Promise<Principal> {
  const inserted = await db.query<{id:string}>("INSERT INTO app_user(username,display_name,password_hash) VALUES($1,'ผู้ใช้จำลอง',$2) RETURNING id", [username, await hashPassword(TEST_PASSWORD)]);
  const id = inserted.rows[0].id;
  if (role !== "LAB_CERTIFIER") await db.query("INSERT INTO role_assignment(user_id,role) VALUES($1,$2)", [id,role]);
  return { id, roles: [role], unitIds: [], permissions: [] };
}
