import type { Queryable } from "../db/connection";
import { appendAudit } from "../db/audit";
import { requirePermission, type Principal } from "../security/policy";
import { settingDefinition } from "./catalog";

type Revision = { id: string; setting_key: string; risk: string; value: unknown; state: string; created_by: string; approved_by: string | null; test_passed: boolean; version: number };
export async function proposeSetting(db: Queryable, user: Principal, key: string, value: unknown, reason: string, previousId?: string): Promise<string> {
  const d = settingDefinition(key);
  const validated = d.schema.parse(value);
  requirePermission(user, d.risk === "CLINICAL" ? "settings.clinical.propose" : d.risk === "INTEGRATION" ? "settings.integration.propose" : "settings.general.change", {}, d.risk === "GENERAL" || d.risk === "SECURITY" ? "write" : "propose");
  if (!reason.trim() || reason.length > 250) throw new Error("REASON_REQUIRED");
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`settings:${key}`]);
  const result = await db.query<{ id: string }>(`INSERT INTO settings_revision(setting_key,version,category,risk,value,state,created_by,reason,previous_revision_id)
    VALUES($1,(SELECT COALESCE(max(version),0)+1 FROM settings_revision WHERE setting_key=$1),$2,$3,$4,'Draft',$5,$6,$7) RETURNING id`, [key, d.category, d.risk, JSON.stringify(validated), user.id, reason.trim(), previousId ?? null]);
  const id=result.rows[0].id;
  await appendAudit(db,{actorId:user.id,action:"SETTING_PROPOSED",resourceType:"SETTING",resourceId:id,details:{outcome:"DRAFT",synthetic:true}});
  return id;
}

export async function validateSetting(db: Queryable, user: Principal, id: string, test: (key: string, value: unknown) => Promise<boolean>): Promise<boolean> {
  const r = (await db.query<Revision>("SELECT * FROM settings_revision WHERE id=$1 FOR UPDATE", [id])).rows[0];
  if (!r || r.created_by !== user.id || r.state !== "Draft") throw new Error("SETTING_DRAFT_REQUIRED");
  settingDefinition(r.setting_key).schema.parse(r.value);
  const passed = await test(r.setting_key, r.value);
  await db.query("UPDATE settings_revision SET state=$2,test_passed=$3 WHERE id=$1", [id, passed ? "Validated" : "Draft", passed]);
  await appendAudit(db,{actorId:user.id,action:"SETTING_TESTED",resourceType:"SETTING",resourceId:id,details:{outcome:passed?"PASSED":"FAILED",synthetic:true}});
  return passed;
}

export async function approveSetting(db: Queryable, user: Principal, id: string): Promise<void> {
  const r = (await db.query<Revision>("SELECT * FROM settings_revision WHERE id=$1 FOR UPDATE", [id])).rows[0];
  if (!r || r.state !== "Validated" || !r.test_passed) throw new Error("SETTING_NOT_VALIDATED");
  requirePermission(user, "settings.approve", { actorId: r.created_by }, "approve");
  await db.query("UPDATE settings_revision SET state='Approved',approved_by=$2 WHERE id=$1", [id, user.id]);
  await appendAudit(db,{actorId:user.id,action:"SETTING_APPROVED",resourceType:"SETTING",resourceId:id,details:{outcome:"APPROVED",synthetic:true}});
}

export async function activateSetting(db: Queryable, user: Principal, id: string): Promise<void> {
  const r = (await db.query<Revision>("SELECT * FROM settings_revision WHERE id=$1 FOR UPDATE", [id])).rows[0];
  if (!r) throw new Error("SETTING_NOT_FOUND");
  const regulated = ["INTEGRATION", "CLINICAL"].includes(r.risk);
  requirePermission(user, regulated ? "settings.approve" : "settings.general.change", { actorId: regulated ? r.created_by : undefined }, regulated ? "approve" : "write");
  if (!r.test_passed || (regulated && (!r.approved_by || r.approved_by === r.created_by)) || !["Validated", "Approved"].includes(r.state)) throw new Error("SETTING_APPROVAL_REQUIRED");
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`settings:${r.setting_key}`]);
  await db.query("UPDATE settings_revision SET state='Archived' WHERE setting_key=$1 AND state='Active'", [r.setting_key]);
  await db.query("INSERT INTO setting_active(setting_key,revision_id) VALUES($1,$2) ON CONFLICT(setting_key) DO UPDATE SET revision_id=excluded.revision_id", [r.setting_key, id]);
  await db.query("UPDATE settings_revision SET state='Active' WHERE id=$1", [id]);
  await appendAudit(db,{actorId:user.id,action:"SETTING_ACTIVATED",resourceType:"SETTING",resourceId:id,details:{outcome:"ACTIVE",version:r.version,synthetic:true}});
}

export async function rollbackSetting(db: Queryable, user: Principal, previousId: string, reason: string): Promise<string> {
  const r = (await db.query<Revision>("SELECT * FROM settings_revision WHERE id=$1", [previousId])).rows[0];
  if (!r || !["Active", "Archived"].includes(r.state)) throw new Error("PREVIOUS_ACTIVE_REVISION_REQUIRED");
  return proposeSetting(db, user, r.setting_key, r.value, reason, r.id); // new version must revalidate/reapprove.
}

export async function readActiveSettings(db: Queryable): Promise<Record<string, unknown>> {
  const result = await db.query<{ setting_key: string; value: unknown }>("SELECT r.setting_key,r.value FROM setting_active a JOIN settings_revision r ON r.id=a.revision_id");
  return Object.fromEntries(result.rows.map(r => [r.setting_key, r.value]));
}
