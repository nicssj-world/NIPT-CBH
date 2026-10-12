import {describe,it,expect} from "vitest";
import fc from "fast-check";
import {compareReceive,receiveOrderSql,parseSortDirection,REGISTRY_DEFAULT_SORT,READY_QUEUE_DEFAULT_SORT} from "../../packages/lab/receive-sort";

const row=(receivedAt:string|null,...keys:string[])=>({receivedAt,keys});
describe("Receive Date/Time ordering semantics (AT-SORT-01/02/05)",()=>{
 it("defaults: registry newest first, Ready Queue oldest first (FIFO)",()=>{expect(REGISTRY_DEFAULT_SORT).toBe("desc");expect(READY_QUEUE_DEFAULT_SORT).toBe("asc");});
 it("orders by actual time, never by tie keys, and toggles direction",()=>{
  const rows=[row("2026-10-12T02:00:00Z","A"),row("2026-10-11T23:30:00Z","B"),row("2026-10-12T01:00:00Z","C")];
  expect([...rows].sort((a,b)=>compareReceive(a,b,"asc")).map(r=>r.keys[0])).toEqual(["B","C","A"]);
  expect([...rows].sort((a,b)=>compareReceive(a,b,"desc")).map(r=>r.keys[0])).toEqual(["A","C","B"]);
 });
 it("missing receipt stays last in both directions and is never treated as now",()=>{
  const rows=[row(null,"Z"),row("2026-10-12T02:00:00Z","A"),row(null,"Y"),row("2026-10-10T02:00:00Z","B")];
  for(const dir of ["asc","desc"] as const){const s=[...rows].sort((a,b)=>compareReceive(a,b,dir));expect(s.slice(2).map(r=>r.keys[0])).toEqual(["Y","Z"]);}
 });
 it("equal times use stable immutable keys that do not flip with the direction",()=>{
  const t="2026-10-12T02:00:00Z",rows=[row(t,"0099002","b"),row(t,"0099001","z"),row(t,"0099001","a")];
  const asc=[...rows].sort((a,b)=>compareReceive(a,b,"asc")).map(r=>r.keys.join()),desc=[...rows].sort((a,b)=>compareReceive(a,b,"desc")).map(r=>r.keys.join());
  expect(asc).toEqual(["0099001,a","0099001,z","0099002,b"]);expect(desc).toEqual(asc);
 });
 it("is a total, deterministic order for any input (refresh/pagination stable)",()=>{
  const arb=fc.array(fc.record({receivedAt:fc.option(fc.date({min:new Date("2020-01-01T00:00:00Z"),max:new Date("2030-01-01T00:00:00Z"),noInvalidDate:true}).map(d=>d.toISOString()),{nil:null}),keys:fc.tuple(fc.string(),fc.uuid())}),{maxLength:30});
  fc.assert(fc.property(arb,fc.constantFrom("asc" as const,"desc" as const),(rows,dir)=>{const a=[...rows].sort((x,y)=>compareReceive(x,y,dir)),b=[...rows].reverse().sort((x,y)=>compareReceive(x,y,dir));return JSON.stringify(a)===JSON.stringify(b);}),{numRuns:200});
 });
 it("SQL order keeps NULLS LAST for both directions and validates the parameter",()=>{
  expect(receiveOrderSql("r.received_at","desc",["l.ln","c.id"])).toBe("r.received_at DESC NULLS LAST,l.ln,c.id");
  expect(receiveOrderSql("r.received_at","asc",[])).toBe("r.received_at ASC NULLS LAST");
  expect(parseSortDirection(null,"desc")).toBe("desc");expect(parseSortDirection("asc","desc")).toBe("asc");expect(()=>parseSortDirection("created_at","desc")).toThrow("SORT_INVALID");
 });
});
