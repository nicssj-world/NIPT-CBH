/* eslint-disable */
// @ts-nocheck -- UAT verification harness (not shipped); loosely typed by design.
// Read-only: run the /api/task3/reports worklist SELECT as the web role against the isolated UAT DB (port 20229) to expose the real error behind the 400.
import {readFileSync} from 'node:fs';
import {client} from './db-env';
const src=readFileSync('packages/readygen/reports.ts','utf8');
const i=src.indexOf('`SELECT h.id row_id,h.sample_key');const j=src.indexOf('`,[q]',i);
const sql=src.slice(i+1,j).replace(/\$1/g,"''");
const c=await client('web');
try{const r=await c.query(sql);console.log('OK rows',r.rowCount);}catch(e){console.log('ERR',(e as Error).message);}
await c.end();
