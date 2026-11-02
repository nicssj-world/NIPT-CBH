import {describe,expect,it} from "vitest";
import {rehearse} from "../../tools/dev/migration-check.mjs";

// The rehearsal runs the REAL migration engine on an in-memory PostgreSQL; this pins that the safety properties hold for the repository's own migrations.
describe("migration rehearsal (synthetic database only)",()=>{
 it("applies the whole chain once, re-applies nothing, and rejects edited, removed and backdated migrations",async()=>{
  const r=await rehearse({base:"HEAD"});
  const failed=r.checks.filter(c=>!c.ok);
  expect(failed,JSON.stringify(failed)).toEqual([]);
  for(const id of ["apply-all-to-empty-database","second-run-reapplies-nothing","edited-applied-migration-rejected","removed-applied-migration-rejected","backdated-migration-rejected","applied-migrations-unchanged-since-base"])
   expect(r.checks.some(c=>c.id===id&&c.ok),id).toBe(true);
 },120000);
 it("validates pending migrations on top of the base schema",async()=>{
  const r=await rehearse({base:"HEAD~12"});
  expect(r.ok,JSON.stringify(r.checks.filter(c=>!c.ok))).toBe(true);
  expect(r.checks.some(c=>c.id==="pending-applied-on-top-of-base-schema")||r.pending.length===0).toBe(true);
 },180000);
});
