/** Disposable native PostgreSQL storage concurrency check. Creates and drops only a uniquely named synthetic DB. */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import {Client} from 'pg';
import {migrate} from '../migrate';
import {labUsers,receiveS1,syntheticCase,tx} from '../../tests/helpers/lab';
import {storageCommand,storageSearch} from '../../packages/lab/sample-storage';

const output='.local/sample-storage-native',secret='.local/owner-local-uat-1.0.2/secrets/migration-url';
await fs.mkdir(output,{recursive:true});
const target=process.env.NIPT_TEST_DATABASE_URL;
const url=new URL(target??(await fs.readFile(secret,'utf8')).trim());
if(target){assert.ok(['127.0.0.1','localhost'].includes(url.hostname));assert.match(url.pathname,/^\/nipt_synthetic_/);}
else{assert.equal(url.hostname,'db');url.hostname='127.0.0.1';url.port='19549';}
const port=Number(url.port);url.pathname='/postgres';
const database=`nipt_synthetic_storage_concurrency_${Date.now()}`,admin=new Client({connectionString:url.toString()});
await admin.connect();await admin.query(`CREATE DATABASE ${database}`);await admin.end();
url.pathname='/'+database;const connectionString=url.toString(),first=new Client({connectionString}),second=new Client({connectionString});
let result:{status:'PASS'|'FAIL';database:string;checks:string[];error?:string}={status:'FAIL',database,checks:[],error:'NATIVE_STORAGE_VERIFICATION_INCOMPLETE'};
try{
 process.env.NIPT_MODE='synthetic';await first.connect();await second.connect();
 await migrate(first);const users=await labUsers(first,'storagenative'),a=await syntheticCase(first,{staff:users.staff,unit:users.unit}),b=await syntheticCase(first,{staff:users.staff,unit:users.unit});
 await receiveS1(first,a,new Date('2026-10-20T01:00:00.000Z'));await receiveS1(first,b,new Date('2026-10-20T02:00:00.000Z'));
 const box=await tx(first,db=>storageCommand(db,users.staff,{action:'createBox',boxType:'BACKUP'}));
 const place=(client:Client,roundId:string)=>tx(client,db=>storageCommand(db,users.staff,{action:'place',roundId,storageType:'BACKUP',boxId:box.id,slot:1}));
 const placements=await Promise.allSettled([place(first,a.roundId),place(second,b.roundId)]);
 assert.equal(placements.filter(x=>x.status==='fulfilled').length,1);
 const placementLoser=placements.find(x=>x.status==='rejected');assert.ok(placementLoser&&placementLoser.status==='rejected');assert.equal(placementLoser.reason.code,'STORAGE_POSITION_OCCUPIED');
 const winner=(await first.query<{round_id:string}>('SELECT round_id FROM lab_storage_typed_position WHERE box_id=$1',[box.id])).rows[0].round_id;
 assert.equal((await first.query('SELECT 1 FROM lab_storage_movement WHERE round_id=$1 AND event_type=$2',[winner,'PLACE'])).rowCount,1);
 const moveBox=await tx(first,db=>storageCommand(db,users.staff,{action:'createBox',boxType:'BACKUP'}));
 const move=(client:Client)=>tx(client,db=>storageCommand(db,users.staff,{action:'move',roundId:winner,storageType:'BACKUP',fromBoxId:box.id,fromSlot:1,toBoxId:moveBox.id,toSlot:1}));
 const moves=await Promise.allSettled([move(first),move(second)]);assert.equal(moves.filter(x=>x.status==='fulfilled').length,1);
 const moveLoser=moves.find(x=>x.status==='rejected');assert.ok(moveLoser&&moveLoser.status==='rejected');assert.equal(moveLoser.reason.code,'STORAGE_MOVE_STALE');
 assert.equal((await storageSearch(first,users.staff,{q:a.ln,boxType:'BACKUP'})).rows.filter(row=>!row.waiting).length+
  (await storageSearch(first,users.staff,{q:b.ln,boxType:'BACKUP'})).rows.filter(row=>!row.waiting).length,1);
 const preview=await tx(first,db=>storageCommand(db,users.staff,{action:'autoFillPreview',storageTypes:['BACKUP']}));assert.equal(preview.waiting,1);assert.equal(preview.planned,1);
 const confirm=(client:Client)=>tx(client,db=>storageCommand(db,users.staff,{action:'autoFillConfirm',storageTypes:['BACKUP'],planHash:preview.planHash}));
 const fills=await Promise.allSettled([confirm(first),confirm(second)]);assert.equal(fills.filter(x=>x.status==='fulfilled').length,1);
 const fillLoser=fills.find(x=>x.status==='rejected');assert.ok(fillLoser&&fillLoser.status==='rejected');assert.equal(fillLoser.reason.code,'STORAGE_PLAN_STALE');
 assert.equal((await storageSearch(first,users.staff,{q:a.ln,boxType:'BACKUP'})).rows.filter(row=>!row.waiting).length+
  (await storageSearch(first,users.staff,{q:b.ln,boxType:'BACKUP'})).rows.filter(row=>!row.waiting).length,2);
 const movementCount=(await first.query<{n:number}>('SELECT count(*)::int n FROM lab_storage_movement')).rows[0].n;assert.equal(movementCount,3);
 result={status:'PASS',database,checks:[
  'Native concurrent placement: one occupied-slot winner and one STORAGE_POSITION_OCCUPIED denial',
  'Native concurrent move: one winner and one STORAGE_MOVE_STALE denial',
  'Native concurrent Auto-fill: one confirmation and one STORAGE_PLAN_STALE denial',
  'Only the winning PLACE/MOVE operations were appended to immutable movement history'
 ]};
 console.log(JSON.stringify(result));
}catch(error){result={status:'FAIL',database,checks:result.checks,error:error instanceof Error?error.message:String(error)};throw error;}
finally{
 await first.end().catch(()=>undefined);await second.end().catch(()=>undefined);
 const cleanup=new Client({connectionString:(()=>{const target=new URL(connectionString);target.pathname='/postgres';return target.toString();})()});
 try{await cleanup.connect();await cleanup.query(`DROP DATABASE IF EXISTS "${database}"`);}finally{await cleanup.end();}
 await fs.writeFile(path.join(output,'result.json'),JSON.stringify({...result,databaseDropped:true,port},null,2));
}
