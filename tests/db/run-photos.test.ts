import {describe,it,expect,beforeEach,afterEach} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {readFile,rename,mkdir,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {testDatabase,addUser} from '../helpers/database';
import {tx,labUsers,setPendingPolicy,syntheticCase,receiveS1,attemptOf,version} from '../helpers/lab';
import {photoRoots,uploadPhoto,syntheticJpeg,PNG_1x1} from '../helpers/photos';
import * as batch from '../../packages/lab/batch';
import * as svc from '../../packages/run-photos/service';
import {getPhoto,photoKey,resetPhotoStorageBreaker} from '../../packages/run-photos/store';
import {verifyPhotoStorage,backupPhotos,restorePhotos,relocateRoot} from '../../packages/run-photos/maintenance';
import type {Queryable} from '../../packages/db/connection';
import type {Staff} from '../../packages/lab/core';

let db:PGlite,u:Awaited<ReturnType<typeof labUsers>>,roots:Awaited<ReturnType<typeof photoRoots>>,admin:Staff;
beforeEach(async()=>{db=await testDatabase();u=await labUsers(db);roots=await photoRoots();admin=await addUser(db,'APP_ADMIN','synthetic.photo.admin') as Staff;});
afterEach(async()=>{await db.close();await roots.close();});
const q=()=>db as unknown as Queryable;
const run=<T>(fn:(t:Queryable)=>Promise<T>)=>tx(q(),fn);
const code=async(p:Promise<unknown>)=>p.then(()=>'OK',(e:{code?:string;message?:string})=>e.code??e.message);

/** A Run with `n` received synthetic samples placed in slot order (slot 1 is the positive control, so samples start at 2). */
async function runWith(n:number){
 await setPendingPolicy(q(),u,'PROCEED_SYNTHETIC_LABELLED');
 const cases=[];for(let i=0;i<n;i++){const c=await run(t=>syntheticCase(t,u));await run(t=>receiveS1(t,c,new Date(Date.now()-(n-i)*60000)));cases.push(c);}
 const b=await run(t=>batch.createBatch(t,u.staff));
 const attempts=await Promise.all(cases.map(c=>attemptOf(q(),c.roundId)));
 if(n)await run(t=>batch.assignToBatch(t,u.staff,{batchId:b.batchId,expectedVersion:0,attemptIds:attempts.map(a=>a.id)}));
 const halos=async(roundId:string)=>(await db.query<{ln_halos:string}>('SELECT ln_halos FROM specimen_lab_number WHERE round_id=$1',[roundId])).rows[0].ln_halos;
 return {batchId:b.batchId,runLabel:b.runLabel,cases:await Promise.all(cases.map(async c=>({...c,lnHalos:await halos(c.roundId)})))};
}
async function finalize(batchId:string,sheet=1){
 await run(async t=>batch.updateSheetPlan(t,u.staff,{batchId,expectedVersion:await version(t,batchId),sheetNumber:sheet,plannedWorkDate:'2026-10-12',plannedOperator:'จำลอง ผู้ปฏิบัติ',plannedExtractionLot:null,plannedExtractionExpiry:null,plannedLibraryLot:null,plannedLibraryExpiry:null}));
 await run(async t=>batch.planCheck(t,u.staff,{batchId,expectedVersion:await version(t,batchId),sheetNumber:sheet,confirm:{controlsAtTemplate:true,identifiersMatch:true,noDuplicates:true}}));
 return run(async t=>batch.finalizeSheet(t,u.staff,{batchId,expectedVersion:await version(t,batchId),sheetNumber:sheet}));
}
/** Cancels the open Draft Run so that the next createBatch opens a second Run. */
async function secondRun(){await run(async t=>{const b=(await t.query<{id:string}>("SELECT id FROM lab_batch WHERE state='Draft'")).rows[0];await batch.cancelBatch(t,u.staff,{batchId:b.id,expectedVersion:await version(t,b.id),reason:'SYNTHETIC second run for photos'});});return run(t=>batch.createBatch(t,u.staff));}

describe('FINAL OWNER LOCK — photos are optional and never gate clinical work',()=>{
 it('a Run without photos is created, filled, plan-checked and finalized normally',async()=>{
  const r=await runWith(3);
  expect((await db.query('SELECT count(*)::int n FROM run_photo')).rows[0]).toEqual({n:0});
  await finalize(r.batchId);
  expect((await db.query<{state:string}>('SELECT state FROM lab_task_sheet WHERE batch_id=$1 AND sheet_number=1',[r.batchId])).rows[0].state).toBe('PlacementFinalized');
 });
 it('no workflow table, constraint, trigger or function depends on run photos',async()=>{
  const fns=(await db.query<{proname:string}>("SELECT proname FROM pg_proc WHERE prosrc ILIKE '%run_photo%' AND proname NOT LIKE 'run\\_photo\\_%'")).rows;
  expect(fns).toEqual([]);
  const fks=(await db.query<{table:string}>("SELECT conrelid::regclass::text \"table\" FROM pg_constraint WHERE contype='f' AND confrelid::regclass::text LIKE 'run_photo%' AND conrelid::regclass::text NOT LIKE 'run_photo%'")).rows;
  expect(fks).toEqual([]);
  const triggers=(await db.query<{t:string}>("SELECT tgrelid::regclass::text t FROM pg_trigger WHERE NOT tgisinternal AND tgfoid IN (SELECT oid FROM pg_proc WHERE proname LIKE 'run\\_photo%') AND tgrelid::regclass::text NOT LIKE 'run_photo%'")).rows;
  expect(triggers).toEqual([]);
 });
 it('an offline photo store does not stop Run work, and only photo operations report the outage',async()=>{
  const r=await runWith(2);
  await uploadPhoto(q(),u.staff,r.batchId);
  await rename(roots.dir('default'),roots.dir('default-offline'));resetPhotoStorageBreaker();
  expect(await code(uploadPhoto(q(),u.staff,r.batchId))).toMatch(/^(FILE_MISSING|STORAGE_UNAVAILABLE)$/);
  // Run work continues while the store is gone.
  await finalize(r.batchId);
  const g=await run(t=>svc.runGallery(t,u.staff,r.batchId));expect(g.photos).toHaveLength(1); // metadata stays listable
  const f=await run(t=>svc.photoForServing(t,u.staff,g.photos[0].id,'original'));
  expect(await code(getPhoto(f.rootPath,f.hash))).toMatch(/^(FILE_MISSING|STORAGE_UNAVAILABLE)$/);
 });
});

describe('upload, thumbnails, provenance and duplicates',()=>{
 it('stores one and several originals byte-for-byte with uploader, time, Run, SHA-256 and a thumbnail',async()=>{
  const r=await runWith(2);const original=syntheticJpeg(4032,3024,200000);
  const one=await uploadPhoto(q(),u.staff,r.batchId,{bytes:original,caption:'ชั้นวางหลอด Task 1',sampleFrom:1,sampleTo:2});
  for(let i=0;i<4;i++)await uploadPhoto(q(),u.staff,r.batchId,{name:`IMG_10${i}.jpg`});
  const g=await run(t=>svc.runGallery(t,u.staff,r.batchId));
  expect(g.photos).toHaveLength(5);
  const p=g.photos.find(x=>x.id===one.photoId)!;
  expect(p).toMatchObject({sha256:one.sha256,bytes:original.length,width:4032,height:3024,hasThumb:true,caption:'ชั้นวางหลอด Task 1',sampleFrom:1,sampleTo:2,uploadedBy:expect.stringContaining('lab'),state:'Active',canManage:true});
  expect(await readFile(path.join(roots.dir('default'),...photoKey(one.sha256).split('/')))).toEqual(original);
  expect((await db.query('SELECT batch_id,uploaded_by FROM run_photo WHERE id=$1',[one.photoId])).rows[0]).toEqual({batch_id:r.batchId,uploaded_by:u.staff.id});
  expect((await db.query("SELECT count(*)::int n FROM audit_chain WHERE action='RUN_PHOTO_UPLOADED'")).rows[0]).toEqual({n:5});
  expect((await svc.photoCounts(q(),[r.batchId]))[r.batchId]).toBe(5);
 });
 it('accepts PNG and works without a thumbnail; refuses non-images whatever their name says',async()=>{
  const r=await runWith(1);
  expect((await uploadPhoto(q(),u.staff,r.batchId,{bytes:PNG_1x1,thumb:null,name:'scan.png'})).photoId).toBeTruthy();
  expect(await code(uploadPhoto(q(),u.staff,r.batchId,{bytes:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),name:'x.jpg'}))).toBe('UNSUPPORTED_IMAGE');
  expect(await code(uploadPhoto(q(),u.staff,r.batchId,{bytes:Buffer.from('GIF89a'+'x'.repeat(40)),name:'x.gif'}))).toBe('UNSUPPORTED_IMAGE');
  expect(await code(uploadPhoto(q(),u.staff,r.batchId,{thumb:Buffer.from('not an image at all, just text')}))).toBe('THUMBNAIL_INVALID');
 });
 it('a duplicate upload to the same Run is refused; the same file in another Run is accepted with a warning; retries replay',async()=>{
  const a=await runWith(1);const bytes=syntheticJpeg();
  const first=await uploadPhoto(q(),u.staff,a.batchId,{bytes,key:'retrykey_0000000001'});
  expect(await uploadPhoto(q(),u.staff,a.batchId,{bytes,key:'retrykey_0000000001'})).toMatchObject({photoId:first.photoId,replayed:true});
  expect(await code(uploadPhoto(q(),u.staff,a.batchId,{bytes}))).toBe('DUPLICATE_IN_RUN');
  const b=await secondRun();
  const other=await uploadPhoto(q(),u.staff,b.batchId,{bytes});
  expect(other.otherRuns).toEqual([a.runLabel]);
  expect(await code(uploadPhoto(q(),u.staff,b.batchId,{bytes:syntheticJpeg(),key:'retrykey_0000000001'}))).toBe('IDEMPOTENCY_KEY_REUSED');
 });
 it('rejects a future photo date and a half or reversed sample range',async()=>{
  const r=await runWith(1);
  expect(await code(uploadPhoto(q(),u.staff,r.batchId,{takenOn:'2099-01-01'}))).toBe('TAKEN_ON_FUTURE');
  await expect(uploadPhoto(q(),u.staff,r.batchId,{sampleFrom:10,sampleTo:5})).rejects.toThrow(/SAMPLE_RANGE_ORDER/);
  await expect(uploadPhoto(q(),u.staff,r.batchId,{sampleFrom:5,sampleTo:null})).rejects.toThrow(/SAMPLE_RANGE_INCOMPLETE/);
 });
});

describe('corrections with permissions and an append-only audit trail',()=>{
 it('only the uploader or a certifier edits, moves or retracts; reasons are required and history is kept',async()=>{
  const a=await runWith(1);const p=await uploadPhoto(q(),u.staff,a.batchId,{caption:'ผิด'});
  const edit={expectedRowVersion:1,caption:'Task 1 คนที่ 1–10',sampleFrom:1,sampleTo:10,takenOn:'2026-10-12'};
  expect(await code(run(t=>svc.editPhoto(t,u.staff2,p.photoId,edit)))).toBe('FORBIDDEN');
  expect(await code(run(t=>svc.editPhoto(t,u.auditor,p.photoId,edit)))).toBe('FORBIDDEN');
  expect(await run(t=>svc.editPhoto(t,u.staff,p.photoId,edit))).toMatchObject({rowVersion:2,changed:true});
  expect(await code(run(t=>svc.editPhoto(t,u.staff,p.photoId,edit)))).toBe('VERSION_CONFLICT');
  const b=await secondRun();
  await expect(run(t=>svc.movePhoto(t,u.certifier,p.photoId,{expectedRowVersion:2,targetBatchId:b.batchId,reason:'สั้น'}))).rejects.toThrow();
  expect(await run(t=>svc.movePhoto(t,u.certifier,p.photoId,{expectedRowVersion:2,targetBatchId:b.batchId,reason:'อัปโหลดผิด Run ย้ายไป Run ที่ถูกต้อง'}))).toMatchObject({batchId:b.batchId,rowVersion:3});
  expect(await run(t=>svc.retractPhoto(t,u.staff,p.photoId,{expectedRowVersion:3,reason:'ภาพเบลอ อ่านฉลากไม่ได้'}))).toMatchObject({rowVersion:4});
  expect(await code(run(t=>svc.editPhoto(t,u.staff,p.photoId,{...edit,expectedRowVersion:4})))).toBe('RUN_PHOTO_RETRACTED');
  const events=(await db.query<{event_type:string;reason:string|null}>('SELECT event_type,reason FROM run_photo_event WHERE photo_id=$1 ORDER BY sequence',[p.photoId])).rows;
  expect(events.map(e=>e.event_type)).toEqual(['UPLOADED','EDITED','MOVED','RETRACTED']);
  // Retracted photos stay on file and are listed only when asked for.
  expect((await run(t=>svc.runGallery(t,u.staff,b.batchId))).photos).toHaveLength(0);
  const all=await run(t=>svc.runGallery(t,u.auditor,b.batchId,{includeRetracted:true}));
  expect(all.photos[0]).toMatchObject({state:'Retracted',retractReason:'ภาพเบลอ อ่านฉลากไม่ได้',canManage:false});
  expect((await run(t=>svc.runGallery(t,u.staff,a.batchId))).history.some(h=>h.type==='MOVED')).toBe(true);
  expect(await getPhoto(roots.dir('default'),p.sha256)).toBeTruthy();
 });
 it('the database refuses deletes, evidence rewrites and history edits',async()=>{
  const r=await runWith(1);const p=await uploadPhoto(q(),u.staff,r.batchId);
  await expect(db.query('DELETE FROM run_photo WHERE id=$1',[p.photoId])).rejects.toThrow(/RUN_PHOTO_DELETE_PROHIBITED/);
  await expect(db.query("UPDATE run_photo SET sha256=repeat('a',64),row_version=row_version+1 WHERE id=$1",[p.photoId])).rejects.toThrow(/RUN_PHOTO_EVIDENCE_IMMUTABLE/);
  await expect(db.query("UPDATE run_photo SET caption='x' WHERE id=$1",[p.photoId])).rejects.toThrow(/VERSION_CONFLICT/);
  await expect(db.query('DELETE FROM run_photo_event')).rejects.toThrow(/append-only/);
  await expect(db.query('UPDATE run_photo_root_location SET root_path=$1',['/elsewhere'])).rejects.toThrow(/append-only/);
 });
 it('roles: auditors read but cannot upload; ANC remains excluded and Admin access keeps its audit identity',async()=>{
  const r=await runWith(1);const p=await uploadPhoto(q(),u.staff,r.batchId);
  expect((await run(t=>svc.runGallery(t,u.auditor,r.batchId))).photos).toHaveLength(1);
  expect(await code(uploadPhoto(q(),u.auditor,r.batchId))).toBe('FORBIDDEN');
  for(const who of [u.anc,u.approver]){
   expect(await code(run(t=>svc.runGallery(t,who as Staff,r.batchId)))).toBe('FORBIDDEN');
   expect(await code(run(t=>svc.photoForServing(t,who as Staff,p.photoId,'thumb')))).toBe('FORBIDDEN');
   expect(await code(run(t=>svc.searchRunPhotos(t,who as Staff,{run:'1'})))).toBe('FORBIDDEN');
  }
  const adminGallery=await run(t=>svc.runGallery(t,admin,r.batchId));
  expect(adminGallery.photos[0]).toMatchObject({id:p.photoId,canManage:true});
  expect((await run(t=>svc.searchRunPhotos(t,admin,{run:'1'}))).photos.map(x=>x.id)).toContain(p.photoId);
  await run(t=>svc.photoForServing(t,admin,p.photoId,'original'));
  const edit={expectedRowVersion:1,caption:'Admin ตรวจและแก้รายการ',sampleFrom:1,sampleTo:1,takenOn:'2026-10-12'};
  await run(t=>svc.editPhoto(t,admin,p.photoId,edit));
  expect((await db.query("SELECT actor_id FROM run_photo_event WHERE photo_id=$1 AND event_type='EDITED'",[p.photoId])).rows).toEqual([{actor_id:admin.id}]);
  expect((await db.query("SELECT actor_id FROM audit_chain WHERE action='RUN_PHOTO_EDITED' ORDER BY sequence DESC LIMIT 1")).rows).toEqual([{actor_id:admin.id}]);
  // Viewing an original is audited; thumbnails are not.
  await run(t=>svc.photoForServing(t,u.staff,p.photoId,'thumb'));await run(t=>svc.photoForServing(t,u.staff,p.photoId,'original'));
  expect((await db.query("SELECT actor_id FROM audit_chain WHERE action='RUN_PHOTO_VIEWED' ORDER BY sequence")).rows).toEqual([{actor_id:admin.id},{actor_id:u.staff.id}]);
 });
});

describe('search and sample linking from the real Run/Task/Patient relations',()=>{
 it('finds Runs and photos by Run number, date, LN Halos, LN HIS, sample order and caption text',async()=>{
  const r=await runWith(12);
  const p1=await uploadPhoto(q(),u.staff,r.batchId,{caption:'Task 1 หลอดคนที่ 1-10',sampleFrom:1,sampleTo:10,takenOn:'2026-10-15'});
  const p2=await uploadPhoto(q(),u.staff,r.batchId,{caption:'คนที่ 11-12',sampleFrom:11,sampleTo:12,takenOn:'2026-10-15'});
  const p3=await uploadPhoto(q(),u.staff,r.batchId,{caption:'ภาพรวมเครื่อง',takenOn:'2026-10-16'});
  const s=(i:object)=>run(t=>svc.searchRunPhotos(t,u.staff,i));
  for(const query of ['1','Run001',r.runLabel,r.runLabel.slice(3)]){const res=await s({run:query});expect(res.runs.map(x=>x.id)).toEqual([r.batchId]);expect(res.photos).toHaveLength(3);}
  expect((await s({run:'999'})).runs).toEqual([]);
  expect((await s({date:'2026-10-16'})).photos.map(x=>x.id)).toEqual([p3.photoId]);
  expect((await s({date:'2026-10-16'})).runs.map(x=>x.id)).toEqual([r.batchId]);
  expect((await s({sample:11})).photos.map(x=>x.id)).toEqual([p2.photoId]);
  expect((await s({text:'1-10'})).photos.map(x=>x.id)).toEqual([p1.photoId]);
  expect((await s({text:'%'})).photos).toEqual([]);
  // Sample 11 sits in slot 12 (slot 1 is the positive control). LN Halos and LN HIS both resolve the same placement.
  const target=r.cases[10];
  for(const input of [{lnHalos:target.lnHalos},{lnHis:target.ln},{lnHalos:target.lnHalos.toLowerCase()}]){
   const res=await s(input);
   expect(res.lnMatches).toEqual([expect.objectContaining({batchId:r.batchId,ordinal:11,slot:12,lnHis:target.ln,lnHalos:target.lnHalos,removed:false})]);
   expect(res.photos).toHaveLength(3);
   // Only the photo whose uploader declared 11–12 is said to cover the sample; the others are just photos of the Run.
   expect(Object.fromEntries(res.photos.map(x=>[x.id,x.coversLnOrdinals]))).toEqual({[p1.photoId]:[],[p2.photoId]:[11],[p3.photoId]:[]});
  }
  expect((await db.query<{n:number}>("SELECT count(*)::int n FROM phi_access_log WHERE purpose='REGISTRY_VIEW' AND actor_id=$1",[u.staff.id])).rows[0].n).toBeGreaterThan(0);
  expect((await s({lnHis:'000'})).lnMatches).toEqual([]);
  expect(await code(s({lnHalos:'NOT-AN-LN'}))).toBe('LN_HALOS_QUERY_INVALID');
  expect(await code(s({run:'Run x'}))).toBe('RUN_QUERY_INVALID');
  // No criteria: recent Runs with their photo counts.
  expect((await s({})).runs).toEqual([expect.objectContaining({id:r.batchId,photos:3,latestTakenOn:'2026-10-16'})]);
 });
 it('gallery numbers samples in slot order without controls, and keeps the placement of a cancelled Run',async()=>{
  const r=await runWith(3);
  const g=await run(t=>svc.runGallery(t,u.staff,r.batchId));
  expect(g.placement.map(x=>[x.ordinal,x.slot])).toEqual([[1,2],[2,3],[3,4]]);
  expect(g.run.placementEditable).toBe(true);
  await run(async t=>batch.cancelBatch(t,u.staff,{batchId:r.batchId,expectedVersion:await version(t,r.batchId),reason:'SYNTHETIC cancel keeps photos'}));
  expect((await run(t=>svc.runGallery(t,u.staff,r.batchId))).placement.map(x=>x.ordinal)).toEqual([1,2,3]);
  expect((await run(t=>svc.searchRunPhotos(t,u.staff,{lnHis:r.cases[2].ln}))).lnMatches[0]).toMatchObject({ordinal:3,removed:false});
 });
});

describe('configurable storage path',()=>{
 it('admin tests and activates a path; new photos go there; old photos stay readable in place; path hidden from others',async()=>{
  const r=await runWith(1);
  const old=await uploadPhoto(q(),u.staff,r.batchId);
  expect(old.root.source).toBe('INSTALLATION_DEFAULT');
  expect(await code(svc.testStoragePath(u.staff,{path:roots.dir('nas')}))).toBe('FORBIDDEN');
  // Missing folder: the test reports it and the path cannot be activated.
  const missing=await svc.testStoragePath(admin,{path:roots.dir('nas')});
  expect(missing.receipt).toMatchObject({ok:false,checks:[{name:'EXISTS',ok:false}, expect.anything(),expect.anything(),expect.anything(),expect.anything()]});
  await mkdir(roots.dir('nas'));
  const tested=await svc.testStoragePath(admin,{path:roots.dir('nas')});
  expect(tested.receipt).toMatchObject({ok:true,account:expect.any(String)});
  expect(tested.receipt.checks.map(c=>c.name)).toEqual(['EXISTS','DIRECTORY','WRITE','READ_BACK','DELETE']);
  expect(await readdir(roots.dir('nas'))).toEqual([]); // the probe cleans up after itself
  await expect(run(t=>svc.activateStoragePath(t,admin,{path:roots.dir('nas'),reason:'สั้น'},tested))).rejects.toThrow();
  const act=await run(t=>svc.activateStoragePath(t,admin,{path:roots.dir('nas'),reason:'ย้ายไป NAS ของห้องปฏิบัติการ'},tested));
  expect(act.retiredRootId).toBe(old.root.root_id);
  expect(await code(run(t=>svc.activateStoragePath(t,admin,{path:roots.dir('nas'),reason:'ย้ายไป NAS ของห้องปฏิบัติการ'},tested)))).toBe('STORAGE_PATH_UNCHANGED');
  const fresh=await uploadPhoto(q(),u.staff,r.batchId);
  expect(fresh.root.root_id).toBe(act.rootId);
  expect(await readFile(path.join(roots.dir('nas'),...photoKey(fresh.sha256).split('/')))).toBeTruthy();
  // The earlier photo was neither moved nor copied and is still served from the retired root.
  const f=await run(t=>svc.photoForServing(t,u.staff,old.photoId,'original'));
  expect(f.rootPath).toBe(roots.dir('default'));expect(await getPhoto(f.rootPath,f.hash)).toBeTruthy();
  await expect(readFile(path.join(roots.dir('nas'),...photoKey(old.sha256).split('/')))).rejects.toThrow();
  // Absolute paths are only shown to those who may change them.
  const asAdmin=await run(t=>svc.storageOverview(t,admin));
  await expect(run(t=>svc.storageOverview(t,u.auditor))).rejects.toThrow('FORBIDDEN'); // LAB-UAT-002 settings are Admin-only.
  expect(asAdmin.roots.map(x=>x.path)).toEqual([roots.dir('nas'),roots.dir('default')]);

  expect(asAdmin.roots.map(x=>[x.state,x.photos])).toEqual([['Active',1],['Retired',1]]);
  await expect(run(t=>svc.storageOverview(t,u.staff))).rejects.toThrow('FORBIDDEN');
  expect(await code(run(t=>svc.storageOverview(t,u.anc as Staff)))).toBe('FORBIDDEN');
  expect((await db.query<{action:string}>("SELECT action FROM audit_chain WHERE action LIKE 'RUN_PHOTO_STORAGE%' ORDER BY sequence")).rows.map(x=>x.action)).toEqual(['RUN_PHOTO_STORAGE_RETIRED','RUN_PHOTO_STORAGE_ACTIVATED']);
 });
 it('a read-only or non-directory target fails the test and is never activated',async()=>{
  await writeFile(roots.dir('afile'),'x');
  const t=await svc.testStoragePath(admin,{path:roots.dir('afile')});
  expect(t.receipt.ok).toBe(false);expect(t.receipt.checks.find(c=>!c.ok)?.name).toBe('DIRECTORY');
  expect(await code(run(x=>svc.activateStoragePath(x,admin,{path:roots.dir('afile'),reason:'ทดสอบเป้าหมายที่ไม่ใช่โฟลเดอร์'},t)))).toBe('STORAGE_TEST_FAILED');
  expect(await code(svc.testStoragePath(admin,{path:'relative\\folder'}))).toBe('PATH_NOT_ABSOLUTE');
 });
});

describe('database ↔ file consistency, backup and restore',()=>{
 it('verifies, backs up, detects tampering, restores to a new server path and records the relocation',async()=>{
  const r=await runWith(1);
  const a=await uploadPhoto(q(),u.staff,r.batchId),b=await uploadPhoto(q(),u.staff,r.batchId,{thumb:null});
  expect(await run(t=>verifyPhotoStorage(t))).toMatchObject({checked:3,ok:3,missing:[],mismatched:[],orphans:[],consistent:true});
  // An unreferenced file (e.g. a failed record after the write) is reported as an orphan, not deleted.
  await mkdir(path.join(roots.dir('default'),'sha256','ff','ff'),{recursive:true});await writeFile(path.join(roots.dir('default'),'sha256','ff','ff','f'.repeat(64)),'orphan');
  expect((await run(t=>verifyPhotoStorage(t))).orphans).toHaveLength(1);
  const backup=await run(t=>backupPhotos(t,roots.dir('backup')));
  expect(backup.files).toBe(3);
  await expect(run(t=>backupPhotos(t,roots.dir('backup')))).rejects.toThrow(/BACKUP_DESTINATION_NOT_EMPTY/);
  // Disaster: the original folder is lost. Restore files to a new path, then record the relocation.
  await rename(roots.dir('default'),roots.dir('lost'));resetPhotoStorageBreaker();
  const broken=await run(t=>verifyPhotoStorage(t));expect(broken.consistent).toBe(false);expect(broken.missing.length+broken.unavailable.length).toBe(3);
  await expect(run(t=>relocateRoot(t,a.root.root_id,roots.dir('restored'),'DR restore to new server'))).rejects.toThrow();
  const restored=await restorePhotos(roots.dir('backup'),a.root.root_id,roots.dir('restored'));
  expect(restored).toMatchObject({written:3,present:0});
  expect(await restorePhotos(roots.dir('backup'),a.root.root_id,roots.dir('restored'))).toMatchObject({written:0,present:3});
  await run(t=>relocateRoot(t,a.root.root_id,roots.dir('restored'),'DR restore to new server'));resetPhotoStorageBreaker();
  expect(await run(t=>verifyPhotoStorage(t))).toMatchObject({consistent:true,ok:3});
  const f=await run(t=>svc.photoForServing(t,u.staff,b.photoId,'original'));expect(f.rootPath).toBe(roots.dir('restored'));
  expect((await db.query<{kind:string}>('SELECT kind FROM run_photo_root_location WHERE root_id=$1 ORDER BY sequence',[a.root.root_id])).rows.map(x=>x.kind)).toEqual(['INITIAL','RELOCATED']);
  // A tampered manifest or file is refused.
  const manifest=path.join(roots.dir('backup'),'manifest.json');await writeFile(manifest,(await readFile(manifest,'utf8')).replace('"bytes"','"bytes" '));
  await expect(restorePhotos(roots.dir('backup'),a.root.root_id,roots.dir('again'))).rejects.toThrow(/BACKUP_MANIFEST_TAMPERED/);
 });
});
