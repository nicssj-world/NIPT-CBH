/** Disposable native PostgreSQL only. Never changes the persistent Owner UAT database. */
import fs,{mkdtemp,rm} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {Client} from 'pg';
import {migrate} from '../migrate';
import {bootstrapAdministrators} from '../../packages/admin/bootstrap';
import {authenticate} from '../../packages/security/session';
import {changePassword,adminCommand} from '../../packages/admin/service';
import {completeTargetEnrollment} from '../../packages/admin/enrollment';
import {labUsers,tx,receiveS1} from '../../tests/helpers/lab';
import {registerP2} from '../../packages/p2/service';
import {storageCommand,storageSearch,storageLabel} from '../../packages/lab/sample-storage';
import {FileStore} from '../../packages/storage';
import {createBatch,stageBatch,getBatch,replaceRowPdf} from '../../packages/historical/service';
import {reviewManual} from '../../packages/historical/manual-review';
import {goodRow,pdfFor,csvOf} from '../../tests/helpers/historical';
import type {Principal} from '../../packages/security/policy';
const out='.local/owner-local-uat-1.0.2/lab32-native';await fs.mkdir(out,{recursive:true});
const url=new URL((await fs.readFile('.local/owner-local-uat-1.0.2/secrets/migration-url','utf8')).trim());assert.equal(url.hostname,'db');url.hostname='127.0.0.1';url.port='19549';url.pathname='/postgres';
const adminUrl=new URL(url.toString()),database='nipt_synthetic_lab32_'+Date.now(),host=new Client({connectionString:url.toString()});await host.connect();await host.query(`CREATE DATABASE ${database}`);await host.end();url.pathname='/'+database;
const db=new Client({connectionString:url.toString()}),temporaryFiles=await mkdtemp(path.join(os.tmpdir(),'nipt-lab32-native-'));const checks:string[]=[];let outcome:{status:'PASS'|'FAIL';database:string;checks:string[];error?:string}={status:'FAIL',database,checks,error:'NATIVE_VERIFICATION_INCOMPLETE'};
try{
 await db.connect();process.env.NIPT_MODE='synthetic';
 await migrate(db);const password=randomBytes(24).toString('hex'),next=randomBytes(24).toString('hex');
 const input={admin:{username:'first.admin',displayName:'Test Admin',password}};
 await tx(db,d=>bootstrapAdministrators(d,input));const login=await tx(db,d=>authenticate(d,'first.admin',password));assert.ok(login);
 const admin:Principal={id:login.userId,roles:['APP_ADMIN'],unitIds:[],permissions:[]};await tx(db,d=>changePassword(d,admin,password,next));
 assert.ok(await tx(db,d=>authenticate(d,'first.admin',next)));await assert.rejects(tx(db,d=>bootstrapAdministrators(d,input)),/EMPTY_INSTALLATION/);
 const created=await tx(db,d=>adminCommand(d,admin,{operation:'saveUser',username:'first.staff',displayName:'Test Staff',password,jobPosition:'Lab',phone:'',unitId:null,enabled:true,roles:['LAB_STAFF'],unitIds:[],permissions:[]}));assert.ok(created.id);checks.push('First install bootstrap, login, password rotation, role management; restart-safe empty-only guard');
 const u=await labUsers(db);
 const checkerId=(await db.query<{id:string}>("SELECT id FROM app_user WHERE username='first.staff'")).rows[0].id; // single APP_ADMIN bootstrap: recover a user it created
 const request=await tx(db,d=>adminCommand(d,admin,{operation:'requestPasswordReset',id:checkerId,version:1,reason:'Disposable first-install access recovery'}));
 await tx(db,d=>adminCommand(d,u.approver,{operation:'approveAccess',id:request.id}));
 const recovered=randomBytes(24).toString('hex');await tx(db,d=>completeTargetEnrollment(d,{requestId:request.id,username:'first.staff',password:recovered,targetIdentityConfirmed:true}));assert.ok(await tx(db,d=>authenticate(d,'first.staff',recovered)));checks.push('Initial access recovery through independent authorization and operator target-only enrollment; no default password');
 const store=new FileStore(path.join(temporaryFiles,'files')),c=await tx(db,d=>registerP2(d,u.staff,{ln:'9903002902',hn:'9900042902',unitId:u.unit,origin:'LAB_DIRECT',identifierSource:'TUBE_LABEL',idempotencyKey:'native_lab32_storage_001'},Buffer.alloc(32,7),{store}));
 const round=(await db.query<{id:string}>('SELECT current_round_id id FROM nipt_case WHERE id=$1',[c.caseId])).rows[0].id,lnId=(await db.query<{id:string}>('SELECT id FROM case_ln WHERE case_id=$1',[c.caseId])).rows[0].id;
 await tx(db,d=>receiveS1(d,{roundId:round,lnId}));
 const box=await tx(db,d=>storageCommand(d,u.staff,{action:'createBox',boxType:'BACKUP'}));
 await tx(db,d=>storageCommand(d,u.staff,{action:'place',roundId:round,storageType:'BACKUP',boxId:box.id,slot:81}));assert.equal((await storageSearch(db,u.staff,{q:'9900042902',boxType:'BACKUP'})).rows[0].position,'I9');assert.equal((await tx(db,d=>storageLabel(d,u.staff,box.id))).subarray(0,5).toString(),'%PDF-');
 const insertAllowed=(await db.query<{allowed:boolean}>("SELECT has_table_privilege('app_rw','lab_storage_typed_position','INSERT') allowed")).rows[0].allowed;assert.equal(insertAllowed,false);
 const concurrent=new Client({connectionString:url.toString()});await concurrent.connect();
 try{
  const moveBox=await tx(db,d=>storageCommand(d,u.staff,{action:'createBox',boxType:'BACKUP'}));
  const move=(client:Client)=>tx(client,d=>storageCommand(d,u.staff,{action:'move',roundId:round,storageType:'BACKUP',fromBoxId:box.id,fromSlot:81,toBoxId:moveBox.id,toSlot:1}));
  const moveResults=await Promise.allSettled([move(db),move(concurrent)]);assert.equal(moveResults.filter(result=>result.status==='fulfilled').length,1);
  const staleMove=moveResults.find(result=>result.status==='rejected');assert.ok(staleMove&&staleMove.status==='rejected');assert.match(String(staleMove.reason),/STORAGE_MOVE_STALE/);
  assert.equal((await storageSearch(db,u.staff,{q:'9900042902',boxType:'BACKUP'})).rows[0].position,'A1');
  const next=await tx(db,d=>registerP2(d,u.staff,{ln:'9903002903',hn:'9900042903',unitId:u.unit,origin:'LAB_DIRECT',identifierSource:'TUBE_LABEL',idempotencyKey:'native_lab32_storage_002'},Buffer.alloc(32,8),{store}));
  const nextRound=(await db.query<{id:string}>('SELECT current_round_id id FROM nipt_case WHERE id=$1',[next.caseId])).rows[0].id,nextLnId=(await db.query<{id:string}>('SELECT id FROM case_ln WHERE case_id=$1',[next.caseId])).rows[0].id;
  await tx(db,d=>receiveS1(d,{roundId:nextRound,lnId:nextLnId}));await tx(db,d=>storageCommand(d,u.staff,{action:'createBox',boxType:'BACKUP'}));
  const preview=await tx(db,d=>storageCommand(d,u.staff,{action:'autoFillPreview',storageTypes:['BACKUP']}));
  const confirm=(client:Client)=>tx(client,d=>storageCommand(d,u.staff,{action:'autoFillConfirm',storageTypes:['BACKUP'],planHash:preview.planHash}));
  const fillResults=await Promise.allSettled([confirm(db),confirm(concurrent)]);assert.equal(fillResults.filter(result=>result.status==='fulfilled').length,1);
  const staleFill=fillResults.find(result=>result.status==='rejected');assert.ok(staleFill&&staleFill.status==='rejected');assert.match(String(staleFill.reason),/STORAGE_PLAN_STALE/);
  assert.equal((await storageSearch(db,u.staff,{q:'9900042903',boxType:'BACKUP'})).rows.filter(row=>!row.waiting).length,1);
  await assert.rejects(db.query("UPDATE lab_storage_movement SET event_type='PLACE' WHERE round_id=$1",[round]),/append-only record/);
  checks.push('Typed storage permission guard, concurrent move and Auto-fill winner/stale rejection, and append-only movement history');
 }finally{await concurrent.end();}
 checks.push('Native typed storage SQL, received specimen at Box001/I9, HN lookup and typed PDF label');
 const r=goodRow(902),b=await tx(db,d=>createBatch(d,u.staff,store,{table:{name:'native.csv',bytes:csvOf([r])},files:[{name:r.pdf_file!,bytes:pdfFor(r)}]}));await tx(db,d=>stageBatch(d,store,b.batchId,u.staff.id));
 let row=(await tx(db,d=>getBatch(d,u.staff,b.batchId))).rows[0];await tx(db,d=>reviewManual(d,u.staff,store,{draftId:row.id,version:row.version,lnMatchesOriginal:true,pdfBindingMatchesOriginal:true,identityMatchesOriginal:true,identityIdentifiersChecked:['HN','NAME'],finalPdfReviewed:true}));assert.equal((await tx(db,d=>getBatch(d,u.staff,b.batchId))).manualSummary.done,1);
 await tx(db,d=>replaceRowPdf(d,u.staff,store,row.id,row.version,{name:'replacement.pdf',bytes:pdfFor(r,{labNumber:'9999999999'})}));row=(await tx(db,d=>getBatch(d,u.staff,b.batchId))).rows[0];assert.ok(row.issues.some(i=>i.code==='PDF_LN_DIFFERS'&&i.severity==='ERROR'));assert.equal((await db.query('SELECT 1 FROM result_release')).rowCount,0);checks.push('Native single-operator Manual Completed, PDF replacement, revision history, identity block and no clinical release');
 const ledger=(await db.query('SELECT name,checksum FROM schema_migration ORDER BY name')).rows;await migrate(db);assert.deepEqual((await db.query('SELECT name,checksum FROM schema_migration ORDER BY name')).rows,ledger);checks.push('Forward migration idempotency; original migration checksums retained');
 outcome={status:'PASS',database,checks};console.log(JSON.stringify(outcome));
}catch(e){outcome={status:'FAIL',database,checks,error:e instanceof Error?e.message:String(e)};throw e;}finally{
 await db.end();adminUrl.pathname='/postgres';const cleanup=new Client({connectionString:adminUrl.toString()});
 try{await cleanup.connect();await cleanup.query(`DROP DATABASE IF EXISTS "${database}"`);}finally{await cleanup.end();await rm(temporaryFiles,{recursive:true,force:true});}
 await fs.writeFile(out+'/result.json',JSON.stringify({...outcome,databaseDropped:true,temporaryFilesRemoved:true,port:19549},null,2));
}
