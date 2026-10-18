import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase,addUser} from '../helpers/database';
import {inboundQueuePage,canSeeLn} from '../../packages/inbound/queue';
import type {Queryable} from '../../packages/db/connection';
import type {Principal} from '../../packages/security/policy';

// /inbound used to show at most the oldest 300 open issues and newest 300 files: an issue past that was unreachable and nothing said so.
// Every list now pages on its own with an exact total, oldest-first issues keep their order, and LN search is limited to roles that may see LN.
let db:PGlite,lab:Principal,admin:Principal;
const q=()=>db as unknown as Queryable;
const REVIEW=130,UNLINKED=70,FILES=110,WAITING=65;
const ln=(n:number)=>String(990000000000+n);
beforeAll(async()=>{
 db=await testDatabase();lab=await addUser(db,'LAB_STAFF','synthetic.inbound.lab');admin=await addUser(db,'APP_ADMIN','synthetic.inbound.admin');
 await db.query(`INSERT INTO his_inbound_file(sha256,state,ln,source_path,path_version,discovered_at)
  SELECT md5(g::text)||md5(g::text||'x'),'Ready',$1::bigint+g,'inbound/20261012/'||($1::bigint+g)||'-7.pet',1,now()-(g||' minutes')::interval FROM generate_series(1,${FILES+REVIEW+UNLINKED}) g`,[990000000000]);
 // the oldest files carry the issues: issue i belongs to file i, created i minutes after a fixed origin so "oldest first" is well defined
 await db.query(`INSERT INTO his_intake_issue(inbound_file_id,ln,kind,state,details,created_at)
  SELECT f.id,f.ln,CASE WHEN r.n<=${REVIEW} THEN 'IDENTITY_MISMATCH' ELSE 'UNLINKED' END,'Open','{"fields":["hn"]}',timestamp '2026-10-01 00:00:00+00'+(r.n||' minutes')::interval
  FROM (SELECT id,ln,row_number() OVER (ORDER BY ln) n FROM his_inbound_file) r JOIN his_inbound_file f ON f.id=r.id WHERE r.n<=${REVIEW+UNLINKED}`);
 await db.query(`INSERT INTO his_inbound_waiting(source_path,first_seen_at,last_seen_at) SELECT 'inbound/20261012/'||(990100000000+g)||'-7.pet',now()-(g||' minutes')::interval,now() FROM generate_series(1,${WAITING}) g`);
});
afterAll(async()=>{await db?.close();});
const page=(raw:Record<string,unknown>={},user=lab)=>inboundQueuePage(q(),user,raw);

describe('inbound lists page independently with exact totals',()=>{
 it('every open issue is reachable once, oldest first; both groups have their own totals',async()=>{
  for(const [group,total] of [['review',REVIEW],['unlinked',UNLINKED]] as const){
   const key=group==='review'?'issuesPage':'unlinkedPage',seen:string[]=[],created:number[]=[];let p=1,pages=1;
   do{const d=await page({[key]:p,pageSize:25});const g=d[group];expect(g.page.total).toBe(total);pages=g.page.totalPages;seen.push(...g.rows.map(i=>i.id));created.push(...g.rows.map(i=>+new Date(i.createdAt)));p++;}while(p<=pages);
   expect(seen).toHaveLength(total);expect(new Set(seen).size).toBe(total);expect(pages).toBe(Math.ceil(total/25));
   expect(created,group).toEqual([...created].sort((a,b)=>a-b)); // Workflow order: oldest first, across pages
  }
  // the 130th review issue is beyond the old limit of 100 (and the newest group member beyond the old 300 cap combined)
  const last=await page({issuesPage:6,pageSize:25});expect(last.review.rows.at(-1)!.ln).toBe(ln(REVIEW));
 });
 it('files page newest first with an exact total; waiting shows its real total with the number shown',async()=>{
  const total=FILES+REVIEW+UNLINKED,seen:string[]=[];let p=1,pages=1;
  do{const d=await page({filesPage:p,pageSize:50});expect(d.files.page.total).toBe(total);pages=d.files.page.totalPages;seen.push(...d.files.rows.map(f=>f.id));p++;}while(p<=pages);
  expect(seen).toHaveLength(total);expect(new Set(seen).size).toBe(total);
  const w=await page();expect(w.waiting).toMatchObject({total:WAITING,shown:50});expect(w.waiting.rows).toHaveLength(50);
 });
 it('LN search narrows every list across all rows for roles that can see LN; a role with masked LN cannot probe it',async()=>{
  const target=ln(REVIEW+5);                         // an UNLINKED issue far past page 1
  const d=await page({q:target});expect(d.unlinked.page.total).toBe(1);expect(d.unlinked.rows[0].ln).toBe(target);expect(d.review.page.total).toBe(0);expect(d.files.page.total).toBe(1);
  const m=await page({q:target},admin);expect(canSeeLn(admin)).toBe(false);
  expect(m.search).toMatchObject({enabled:false});expect(m.unlinked.page.total).toBe(UNLINKED);expect(m.unlinked.rows[0].ln).toMatch(/^••••/); // q ignored, LN masked
  expect((await page({q:'zzz'})).review.page).toMatchObject({total:0,number:1,totalPages:1});
 });
 it('page size is 25/50/100 only; a page past the end gives the last page; unknown fields are refused',async()=>{
  await expect(page({pageSize:10})).rejects.toThrow();await expect(page({bogus:1})).rejects.toThrow();await expect(page({issuesPage:0})).rejects.toThrow();
  const past=await page({issuesPage:999,pageSize:25});expect(past.review.page.number).toBe(6);expect(past.review.rows).toHaveLength(REVIEW-125);
 });
});
