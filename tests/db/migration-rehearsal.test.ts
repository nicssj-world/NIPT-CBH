import {describe,expect,it} from "vitest";
import {execFileSync} from "node:child_process";
import {rehearse} from "../../tools/dev/migration-check.mjs";

// "Pending on top of the base schema" is relative to the installed release, not to a fixed number of commits: HEAD~12 moves with every commit and, on a
// branch that edited a migration it had not shipped yet, lands after its first version. NIPT_MIGRATION_BASE (the Production commit) wins, then the
// merge-base with origin/main, then the old HEAD~12.
const baseRevision=()=>{
 if(process.env.NIPT_MIGRATION_BASE)return process.env.NIPT_MIGRATION_BASE;
 try{return execFileSync("git",["merge-base","HEAD","origin/main"],{encoding:"utf8"}).trim();}catch{return "HEAD~12";}
};

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
  const r=await rehearse({base:baseRevision()});
  expect(r.ok,JSON.stringify(r.checks.filter(c=>!c.ok))).toBe(true);
  expect(r.checks.some(c=>c.id==="pending-applied-on-top-of-base-schema")||r.pending.length===0).toBe(true);
 },180000);
});
