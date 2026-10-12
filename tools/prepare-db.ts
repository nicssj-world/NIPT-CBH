import {Pool,escapeIdentifier,escapeLiteral} from "pg";
import {readFile} from "node:fs/promises";
import {PgBoss} from "pg-boss";
import {assertSyntheticDatabase} from "../packages/db/connection";
import {migrate} from "./migrate";
const url=process.env.MIGRATION_DATABASE_URL_FILE?(await readFile(process.env.MIGRATION_DATABASE_URL_FILE,"utf8")).trim():process.env.DATABASE_URL??"";assertSyntheticDatabase(url);
const admin=new Pool({connectionString:url});const client=await admin.connect();
try{await migrate(client);}finally{client.release();}
const boss=new PgBoss(url);await boss.start();await boss.stop();
const roles=await readFile("packages/db/roles.sql","utf8");await admin.query(roles);
await admin.query(await readFile("packages/db/roles-p3.sql","utf8"));
for(const [login,role,file] of [["nipt_web","app_rw",process.env.WEB_DB_PASSWORD_FILE??"data/secrets/web-password"],["nipt_worker","worker_rw",process.env.WORKER_DB_PASSWORD_FILE??"data/secrets/worker-password"]]){
 const password=(await readFile(file,"utf8")).trim();if(password.length<24)throw Error("DATABASE_PASSWORD_TOO_SHORT");
 const exists=await admin.query("SELECT 1 FROM pg_roles WHERE rolname=$1",[login]);
 if(!exists.rowCount)await admin.query(`CREATE ROLE ${escapeIdentifier(login)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${escapeLiteral(password)}`);
 await admin.query(`GRANT ${escapeIdentifier(role)} TO ${escapeIdentifier(login)}`);
}
await admin.query("GRANT USAGE ON SCHEMA pgboss TO worker_rw; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA pgboss TO worker_rw; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO worker_rw");
await admin.query("GRANT SELECT,INSERT ON file_asset,case_event TO worker_rw");
await admin.end();process.stdout.write("Synthetic migrations, queue schema and least-privilege database logins prepared.\n");
