import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {resultFixture,importReport,type ResultFixture} from '../helpers/results';
import {exportResultPage,queryResults} from '../../packages/results/query';
import type {Principal} from '../../packages/security/policy';

// The Results queue was already server-paged (BOUNDED_PAGE) but had no total, a default of 100 and no way to say how many rows matched.
// It now reports an exact total and total pages for the same filters, defaults to 50 and clamps a page past the end; CSV stays one page.
let f:ResultFixture,user:Principal;
const EXTRA=130;
async function session(u:Principal){const id=(await f.db.query<{id:string}>("INSERT INTO app_session(user_id,token_hash,csrf_hash,idle_expires_at,absolute_expires_at) VALUES($1,$2,$3,now()+interval '1 hour',now()+interval '2 hours') RETURNING id",[u.id,createHash('sha256').update(randomUUID()).digest('hex'),'c'.repeat(64)])).rows[0].id;return {...u,sessionId:id} as Principal;}
const spec=(hn:string)=>({kind:'SINGLETON' as const,labNumber:'0000123',hn,collection:'10-Oct-2026',reported:'20-Oct-2026'});
const query=(raw:Record<string,unknown>={})=>f.run(t=>queryResults(t,user,raw));
beforeAll(async()=>{
 f=await resultFixture();user=await session(f.u.staff);
 await importReport(f,{...spec('00001'),name:'NEEDLE SYNTHETIC'});
 // Clone the real parsed row to a realistic queue length (replica role: this is a disposable test database).
 await f.db.exec('SET session_replication_role=replica');
 await f.db.query(`WITH g AS (SELECT gen_random_uuid() iid,gen_random_uuid() vid,s,md5(s::text||'a')||md5(s::text||'b') sha FROM generate_series(1,${EXTRA}) s),
  i AS (INSERT INTO result_intake_file(id,source,relative_path,original_name,sha256,byte_size,container,state,parser_version,template_kind,parsed,actor_id,synthetic)
   SELECT iid,s0.source,s0.relative_path,'CLONE-'||g.s||'.pdf',g.sha,s0.byte_size,s0.container,s0.state,s0.parser_version,s0.template_kind,s0.parsed,s0.actor_id,true FROM g,(SELECT * FROM result_intake_file LIMIT 1) s0)
  INSERT INTO result_report_version(id,intake_file_id,sha256,kind,template_kind,template_version,parser_version,parsed,state,imported_by,imported_at,state_changed_at,row_version,synthetic)
   SELECT vid,iid,g.sha,v0.kind,v0.template_kind,v0.template_version,v0.parser_version,jsonb_set(v0.parsed,'{identifiers,patientName,value}',to_jsonb('CLONE '||g.s)),v0.state,v0.imported_by,v0.imported_at-(g.s||' minutes')::interval,v0.state_changed_at-(g.s||' minutes')::interval,1,true
   FROM g,(SELECT * FROM result_report_version ORDER BY imported_at LIMIT 1) v0`);
 await f.db.exec('SET session_replication_role=origin');
},300000);
afterAll(async()=>{await f?.close();});

describe('results queue paging',()=>{
 it('defaults to 50 per page and reports an exact total and page count for the same filters',async()=>{
  const r=await query();expect(r.page).toMatchObject({number:1,size:50,total:EXTRA+1,totalPages:Math.ceil((EXTRA+1)/50),hasNext:true,scope:'BOUNDED_PAGE'});expect(r.rows).toHaveLength(50);
  for(const size of [25,50,100]){const p=await query({pageSize:size});expect(p.page).toMatchObject({size,total:EXTRA+1,totalPages:Math.ceil((EXTRA+1)/size)});}
 });
 it('every row is reachable exactly once, newest change first, and the total is what paging returns',async()=>{
  const ids:string[]=[];let p=1,pages=1;
  do{const r=await query({page:p,pageSize:25});pages=r.page.totalPages;expect(r.page.hasNext).toBe(p<pages);ids.push(...r.rows.map(x=>x.id));p++;}while(p<=pages);
  expect(ids).toHaveLength(EXTRA+1);expect(new Set(ids).size).toBe(EXTRA+1);
  const expected=(await f.db.query<{id:string}>('SELECT id FROM result_report_version ORDER BY state_changed_at DESC,id DESC')).rows.map(r=>r.id);expect(ids).toEqual(expected);
 });
 it('the total follows the filters (search, bucket, risk) and a page past the end is the last page',async()=>{
  expect((await query({q:'NEEDLE'})).page).toMatchObject({total:1,totalPages:1});
  expect((await query({q:'CLONE 1'})).page.total).toBeGreaterThan(1);
  expect((await query({q:'no-such-patient'})).page).toMatchObject({total:0,number:1,totalPages:1});
  expect((await query({bucket:'closed'})).page.total).toBe(0);
  const last=await query({page:999,pageSize:100});expect(last.page.number).toBe(2);expect(last.rows).toHaveLength(EXTRA+1-100);
 });
 it('CSV export stays one page of the filtered queue and records that page',async()=>{
  const out=await f.run(t=>exportResultPage(t,user,{pageSize:25,page:2}));
  expect(out.rows).toHaveLength(25);expect(out.page).toMatchObject({number:2,size:25,total:EXTRA+1});
  expect(out.csv.split('\r\n').filter(Boolean)).toHaveLength(26); // header + one page
  const ev=(await f.db.query<{page:number;page_size:number;has_next:boolean}>('SELECT page,page_size,has_next FROM result_query_export_evidence ORDER BY created_at DESC LIMIT 1')).rows[0];
  expect(ev).toMatchObject({page:2,page_size:25,has_next:true});
 });
});
