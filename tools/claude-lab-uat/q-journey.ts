/* eslint-disable */
// @ts-nocheck -- UAT verification harness (not shipped); loosely typed by design.
import {client} from './db-env';
const c=await client('migrator');
const q=async(l:string,s:string)=>{try{console.log(l,JSON.stringify((await c.query(s)).rows).slice(0,500));}catch(e){console.log(l,'ERR',(e as Error).message);}};
await q('doctors',"SELECT * FROM p2_doctor_version ORDER BY created_at DESC LIMIT 3");
await c.end();
