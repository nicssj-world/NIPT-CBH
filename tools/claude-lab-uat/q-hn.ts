/* eslint-disable */
// @ts-nocheck -- UAT verification harness (not shipped).
import {client} from './db-env';
const c=await client('migrator');
const q=async(l,s)=>{try{console.log(l,JSON.stringify((await c.query(s)).rows).slice(0,500));}catch(e){console.log(l,'ERR',e.message);}};
await q('cols',"SELECT column_name,is_nullable FROM information_schema.columns WHERE table_name='p2_case_identity'");
await q('no-hn',"SELECT c.id,c.registration_origin,i.hn FROM nipt_case c JOIN p2_case_identity i ON i.case_id=c.id WHERE i.hn IS NULL OR i.hn='' LIMIT 3");
await q('lab-reg-hn-optional',"SELECT count(*) FROM p2_case_identity WHERE hn IS NULL");
await c.end();
