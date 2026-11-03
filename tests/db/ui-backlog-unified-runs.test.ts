import {it,expect} from "vitest";
import {createHash} from "node:crypto";
import {resultFixture} from "../helpers/results";
import {createBatch} from "../../packages/lab/batch";
import {listUnifiedRunPage} from "../../packages/lab/historical-run";

// UI-011: one table for current and historical Runs, newest recorded Run first. Order follows run_year/run_number, never insert order.
it("UI-011 unified run list sorts by run_year DESC, run_number DESC regardless of insert time, keeps historical read-only, searches and pages",async()=>{
 const f=await resultFixture();try{
  const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
  const x=(await f.db.query<{id:string}>("INSERT INTO migration_execution(plan_digest,plan,created_by) VALUES($1,'{}',$2) RETURNING id",[hash("plan"),f.u.staff.id])).rows[0].id;
  // inserted in an order that is deliberately not the display order
  for(const [year,n] of [[2026,7],[2024,120],[2025,3]] as const){
   const sha=hash(`run-${year}-${n}`);
   await f.db.query("INSERT INTO file_asset(sha256,storage_key,byte_size,media_type) VALUES($1,$1,36,'application/octet-stream')",[sha]);
   await f.db.query("INSERT INTO migration_historical_run(execution_id,run_year,run_number,run_label,source_sha256) VALUES($1,$2,$3,$4,$5)",[x,year,n,`Run${String(n).padStart(3,"0")}/${year}`,sha]);
  }
  const current=await f.run(db=>createBatch(db,f.u.staff));
  const page=await f.run(db=>listUnifiedRunPage(db,f.u.staff,{pageSize:10}));
  const keys=page.rows.map(r=>[r.run_year,r.run_number]);
  expect(keys).toEqual([...keys].sort((a,b)=>b[0]-a[0]||b[1]-a[1]));
  expect(page.page.total).toBe(4);
  expect(page.rows.filter(r=>r.source==="HISTORICAL")).toHaveLength(3);
  for(const r of page.rows.filter(r=>r.source==="HISTORICAL"))expect(r.id).toBeNull();
  expect(page.rows.find(r=>r.source==="CURRENT")?.id).toBe(current.batchId);
  const search=await f.run(db=>listUnifiedRunPage(db,f.u.staff,{q:"run120"}));
  expect(search.rows.map(r=>r.run_label)).toEqual(["Run120/2024"]);
  const small=await f.run(db=>listUnifiedRunPage(db,f.u.staff,{pageSize:10,page:99}));
  expect(small.page.number).toBe(1);
 }finally{await f.close();}
},120000);
