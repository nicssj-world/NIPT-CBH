import {beforeAll,afterAll,it,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase,addUser} from '../helpers/database';
import {tx,receiveS1} from '../helpers/lab';
import {registerP2,listP2Cases,type Staff} from '../../packages/p2/service';
import type {Queryable} from '../../packages/db/connection';
let db:PGlite,anc:Staff,unit:string;
const key=Buffer.alloc(32,7),created:{id:string;ln:string;received:number|null}[]=[];
beforeAll(async()=>{db=await testDatabase();anc=await addUser(db,'ANC_NURSE','synthetic.registry.owner');unit=(await db.query<{id:string}>("INSERT INTO unit(code,name) VALUES('SYNTHETIC_OWNER_SORT','ANC owner sort') RETURNING id")).rows[0].id;anc.unitIds=[unit];await db.query('INSERT INTO user_unit_scope(user_id,unit_id) VALUES($1,$2)',[anc.id,unit]);
 const add=async(i:number)=>{const ln='00990'+String(i).padStart(5,'0');const c=await registerP2(db,anc,{ln,hn:'009900001',origin:'ANC',unitId:unit,idempotencyKey:'SYNTHETIC_OWNER_SORT_'+i},key);const r=(await db.query<{roundId:string;lnId:string}>('SELECT c.current_round_id "roundId",l.id "lnId" FROM nipt_case c JOIN case_ln l ON l.case_id=c.id WHERE c.id=$1',[c.caseId])).rows[0];const received=i<26?Date.UTC(2026,8,30-Math.floor(i/2)):null;if(received!==null)await receiveS1(db as unknown as Queryable,r,new Date(received),'2026-08-01');created.push({id:c.caseId!,ln,received});};
 for(let i=1;i<=29;i++)await tx(db as unknown as Queryable,()=>add(i));
 await tx(db as unknown as Queryable,async()=>{await add(30);await add(31);});
},60000);
afterAll(async()=>{await db?.close();});
it('registration default pages all31 by registration timestamp and immutable id, not reversed receipt times',async()=>{const expected=(await db.query<{id:string}>('SELECT id FROM nipt_case ORDER BY created_at DESC,id')).rows.map(r=>r.id);const a=await listP2Cases(db,anc,{pageSize:25}),b=await listP2Cases(db,anc,{pageSize:25,page:2});expect(a.page.total).toBe(31);expect([...a.cases,...b.cases].map(c=>c.id)).toEqual(expected);expect(a.cases.every(c=>c.received_at===null)||a.cases[0].received_at===null).toBe(true);});
it('both receipt orders span pages, retain null last and stable ties; leading-zero HN and formatted LN match',async()=>{for(const sort of ['asc','desc'] as const){const expected=[...created].sort((a,b)=>a.received===null?(b.received===null?a.ln.localeCompare(b.ln)||a.id.localeCompare(b.id):1):b.received===null?-1:(sort==='asc'?a.received-b.received:b.received-a.received)||a.ln.localeCompare(b.ln)||a.id.localeCompare(b.id));const a=await listP2Cases(db,anc,{sort,pageSize:25}),b=await listP2Cases(db,anc,{sort,pageSize:25,page:2});expect([...a.cases,...b.cases].map(c=>c.id)).toEqual(expected.map(c=>c.id));}
 const hn=await listP2Cases(db,anc,{q:'009900001',pageSize:100});expect(hn.cases).toHaveLength(31);expect(hn.cases.every(c=>c.hn==='009900001')).toBe(true);const ln=created[0].ln;const formatted=`${ln.slice(0,2)}-${ln.slice(2,5)}-${ln.slice(5,6)}-${ln.slice(6)}`;const one=await listP2Cases(db,anc,{q:formatted,pageSize:25});expect(one.cases.map(c=>c.id)).toEqual([created[0].id]);});
