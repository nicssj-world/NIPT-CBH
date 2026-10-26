import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {copyFile,mkdtemp,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {migrate} from '../../tools/migrate';
import {histFixture,goodRow,pdfFor,importBatch,view} from '../helpers/historical';
import {registerP2} from '../../packages/p2/service';
import {storageSearch,storageCommand,storageLabel,storageSampleLabel} from '../../packages/lab/sample-storage';
import {orderRedraw,receiveRedraw} from '../../packages/lab/intake';
import {replaceRowPdf,getBatch} from '../../packages/historical/service';
import {reviewManual} from '../../packages/historical/manual-review';
import {authorize} from '../../packages/security/policy';
import {syntheticCase,receiveS1,labUsers} from '../helpers/lab';

async function readStorageLabelPdf(bytes:Buffer){
 const {getDocument,OPS,Util}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const task=getDocument({data:new Uint8Array(bytes),verbosity:0}),doc=await task.promise,texts:string[]=[],barcodes:string[]=[],barCounts:number[]=[],pages:number[][]=[];
 try{
  for(let pageNumber=1;pageNumber<=doc.numPages;pageNumber++){
   const page=await doc.getPage(pageNumber),text=(await page.getTextContent()).items.filter(item=>'str'in item).map(item=>'str'in item?item.str:'').join(' ').replace(/\s+/g,' ');
   texts.push(text);pages.push([...page.view]);
   const operators=await page.getOperatorList(),rectangles:{x:number;y:number;width:number;height:number}[]=[],stack:number[][]=[];let matrix=[1,0,0,1,0,0];
   for(let i=0;i<operators.fnArray.length;i++){
    const op=operators.fnArray[i],args=operators.argsArray[i];
    if(op===OPS.save)stack.push([...matrix]);
    else if(op===OPS.restore)matrix=stack.pop()??[1,0,0,1,0,0];
    else if(op===OPS.transform)matrix=Util.transform(matrix,args);
    else if(op===OPS.constructPath){
     const box=args[2] as Float32Array|number[];
     if(box&&box.length===4){
      const x=matrix[0]*box[0]+matrix[2]*box[1]+matrix[4],y=matrix[1]*box[0]+matrix[3]*box[1]+matrix[5];
      const width=Math.hypot(matrix[0],matrix[1])*box[2],height=Math.hypot(matrix[2],matrix[3])*box[3];
      if(height>8.9&&height<9.1)rectangles.push({x,y,width,height});
     }
    }
   }
   const encodings:Record<string,number>={'0':0x034,'1':0x121,'2':0x061,'3':0x160,'4':0x031,'5':0x130,'6':0x070,'7':0x025,'8':0x124,'9':0x064,B:0x049,D:0x019,R:0x106,'-':0x0a8,'*':0x094};
   const inverse=new Map(Object.entries(encodings).map(([char,encoding])=>[encoding.toString(2).padStart(9,'0').replaceAll('1','w').replaceAll('0','n'),char])),midpoint=(page.view[2]-page.view[0])/2;
   for(const half of [0,1]){
    const left=page.view[0]+half*midpoint,bars=rectangles.filter(rectangle=>rectangle.x+rectangle.width/2>=left&&rectangle.x+rectangle.width/2<left+midpoint).sort((a,b)=>a.x-b.x);
    if(!bars.length)continue;
    if(bars.length%5!==0)throw new Error('PDF_BARCODE_GEOMETRY_INVALID');
    let decoded='';
    for(let i=0;i<bars.length;i+=5){
     const group=bars.slice(i,i+5),units:string[]=[];
     for(let j=0;j<group.length;j++){
      units.push(group[j].width>0.4?'w':'n');
      if(j<group.length-1){const space=group[j+1].x-(group[j].x+group[j].width);units.push(space>0.4?'w':'n');}
     }
     const char=inverse.get(units.join(''));if(!char)throw new Error('PDF_BARCODE_CODE39_DECODE_FAILED');decoded+=char;
     if(i+5<bars.length){const inter=bars[i+5].x-(group[4].x+group[4].width);if(Math.abs(inter-0.25)>0.03)throw new Error('PDF_BARCODE_INTERCHAR_GAP_INVALID');}
    }
    if(!decoded.startsWith('*')||!decoded.endsWith('*'))throw new Error('PDF_BARCODE_START_STOP_INVALID');
    barcodes.push(decoded.slice(1,-1));barCounts.push(bars.length);
   }
  }
  return {text:texts.join(' '),barcodes,barCounts,pages,pageCount:doc.numPages};
 }finally{await task.destroy();}
}
async function receiveRedrawRound(db:import('../../packages/db/connection').Queryable,caseLnId:string,roundId:string,receipt:Date){
 const hash=createHash('sha256').update(`${caseLnId}:${roundId}:${receipt.toISOString()}`).digest('hex');
 const inbound=(await db.query<{id:string}>("INSERT INTO his_inbound_file(sha256,state) VALUES($1,'Applied(Redraw)') RETURNING id",[hash])).rows[0].id;
 await db.query('INSERT INTO his_order(case_ln_id,inbound_file_id,his_received_at,round_id) VALUES($1,$2,$3,$4)',[caseLnId,inbound,receipt,roundId]);
 await db.query("UPDATE specimen_round SET received_source='HIS_PET_RECEIPT',received_at=$2,state='ReceivedInHIS',collection_date=$3 WHERE id=$1",[roundId,receipt,receipt.toISOString().slice(0,10)]);
}
it('LAB-UAT-003: migration 126 preserves generic stored samples as legacy and keeps their old evidence immutable',async()=>{
 const db=new PGlite(),migrationSource=path.resolve('db/migrations'),before126=await mkdtemp(path.join(os.tmpdir(),'nipt-storage-pre-126-'));
 try{
  for(const name of (await readdir(migrationSource)).filter(name=>/^\d+.*\.sql$/.test(name)&&Number.parseInt(name,10)<126))await copyFile(path.join(migrationSource,name),path.join(before126,name));
  await migrate(db,before126);const u=await labUsers(db),sample=await syntheticCase(db,u);await receiveS1(db,sample,new Date('2026-10-20T01:00:00Z'));
  const box=(await db.query<{id:string}>('INSERT INTO lab_storage_box(box_id,created_by) VALUES($1,$2) RETURNING id',['BoxLegacy001',u.staff.id])).rows[0];
  const position=(await db.query<{id:string}>('INSERT INTO lab_storage_position(box_id,slot,round_id,stored_by) VALUES($1,1,$2,$3) RETURNING id',[box.id,sample.roundId,u.staff.id])).rows[0];
  await migrate(db,migrationSource);
  expect((await db.query<{n:number}>("SELECT count(*)::int n FROM lab_storage_position WHERE id=$1 AND round_id=$2",[position.id,sample.roundId])).rows[0].n).toBe(1);
  expect((await db.query<{box_type:string}>("SELECT box_type FROM lab_storage_box WHERE id=$1",[box.id])).rows[0].box_type).toBe('LEGACY_UNCLASSIFIED');
  const stored=await storageSearch(db,u.staff,{q:sample.ln});expect(stored.rows).toHaveLength(1);expect(stored.rows[0]).toMatchObject({storageType:'LEGACY_UNCLASSIFIED',boxId:'BoxLegacy001',position:'A1'});
  await expect(db.query("UPDATE lab_storage_position SET slot=2 WHERE id=$1",[position.id])).rejects.toThrow('append-only record');
 }finally{await db.close();await rm(before126,{recursive:true,force:true});}
});
it('LAB-UAT-003: Backup and Buffy Coat boxes are separate storage types',async()=>{
 const f=await histFixture();try{
  const backup=await f.run(db=>storageCommand(db,f.maker,{action:'createBox',boxType:'BACKUP'}));
  const buffy=await f.run(db=>storageCommand(db,f.maker,{action:'createBox',boxType:'BUFFY_COAT'}));
  expect(backup).toMatchObject({boxType:'BACKUP'});expect(buffy).toMatchObject({boxType:'BUFFY_COAT'});
  expect(backup.id).not.toBe(buffy.id);
  expect((await f.run(db=>storageSearch(db,f.maker,{boxType:'BACKUP'}))).boxes.map(b=>b.boxType)).toEqual(['BACKUP']);
  expect((await f.run(db=>storageSearch(db,f.maker,{boxType:'BUFFY_COAT'}))).boxes.map(b=>b.boxType)).toEqual(['BUFFY_COAT']);
 }finally{await f.close();}
});
it('LAB-UAT-003: one received specimen has the unsuffixed Buffy Coat and -3 Backup identities, with append-only moves',async()=>{
 const f=await histFixture();try{
  const c=await f.run(db=>syntheticCase(db,f.u));await f.run(db=>receiveS1(db,c,new Date('2026-10-20T01:00:00Z')));
  const lnHalos=(await f.db.query<{ln_halos:string}>('SELECT ln_halos FROM specimen_lab_number WHERE round_id=$1',[c.roundId])).rows[0].ln_halos;
  const buffyBox=await f.run(db=>storageCommand(db,f.maker,{action:'createBox',boxType:'BUFFY_COAT'}));
  const backupBox=await f.run(db=>storageCommand(db,f.maker,{action:'createBox',boxType:'BACKUP'}));
  await f.run(db=>storageCommand(db,f.maker,{action:'place',roundId:c.roundId,storageType:'BUFFY_COAT',boxId:buffyBox.id,slot:1}));
  await expect(f.run(db=>storageCommand(db,f.maker,{action:'place',roundId:c.roundId,storageType:'BUFFY_COAT',boxId:backupBox.id,slot:1}))).rejects.toThrow('STORAGE_BOX_TYPE_MISMATCH');
  await f.run(db=>storageCommand(db,f.maker,{action:'place',roundId:c.roundId,storageType:'BACKUP',boxId:backupBox.id,slot:1}));
  const second=await f.run(db=>syntheticCase(db,f.u));await f.run(db=>receiveS1(db,second,new Date('2026-10-20T02:00:00Z')));
  await f.run(db=>storageCommand(db,f.maker,{action:'place',roundId:second.roundId,storageType:'BUFFY_COAT',boxId:buffyBox.id,slot:2}));
  const buffy=await f.run(db=>storageSearch(db,f.maker,{q:lnHalos,boxType:'BUFFY_COAT'}));
  const backup=await f.run(db=>storageSearch(db,f.maker,{q:lnHalos,boxType:'BACKUP'}));
  expect(buffy.rows[0]).toMatchObject({storageType:'BUFFY_COAT',storageLabel:lnHalos,position:'A1'});
  expect(backup.rows[0]).toMatchObject({storageType:'BACKUP',storageLabel:`${lnHalos}-3`,position:'A1'});
  await f.run(db=>storageCommand(db,f.maker,{action:'move',roundId:c.roundId,storageType:'BACKUP',fromBoxId:backupBox.id,fromSlot:1,toBoxId:backupBox.id,toSlot:2}));
  expect((await f.run(db=>storageSearch(db,f.maker,{q:lnHalos,boxType:'BACKUP'}))).rows[0].position).toBe('B1');
  await expect(f.run(db=>storageCommand(db,f.maker,{action:'move',roundId:c.roundId,storageType:'BACKUP',fromBoxId:backupBox.id,fromSlot:1,toBoxId:backupBox.id,toSlot:3}))).rejects.toThrow('STORAGE_MOVE_STALE');
  await expect(f.run(db=>storageCommand(db,f.maker,{action:'move',roundId:c.roundId,storageType:'BUFFY_COAT',fromBoxId:buffyBox.id,fromSlot:1,toBoxId:buffyBox.id,toSlot:2}))).rejects.toThrow('STORAGE_POSITION_OCCUPIED');
  expect((await f.db.query('SELECT 1 FROM lab_storage_movement WHERE round_id=$1',[c.roundId])).rows).toHaveLength(3);
 }finally{await f.close();}
});
it('LAB-UAT-003: verified PET retention and sample/box PDFs read back exact identifiers, types, and barcode',async()=>{
 const f=await histFixture();try{
  const c=await f.run(db=>syntheticCase(db,f.u,{ln:'9903002911'})),petReceipt=new Date('2024-02-29T15:45:00.000Z');
  await f.run(db=>receiveS1(db,c,petReceipt));
  const backupBox=await f.run(db=>storageCommand(db,f.maker,{action:'createBox',boxType:'BACKUP'}));
  const buffyBox=await f.run(db=>storageCommand(db,f.maker,{action:'createBox',boxType:'BUFFY_COAT'}));
  await f.run(db=>storageCommand(db,f.maker,{action:'place',roundId:c.roundId,storageType:'BACKUP',boxId:backupBox.id,slot:1}));
  await f.run(db=>storageCommand(db,f.maker,{action:'place',roundId:c.roundId,storageType:'BUFFY_COAT',boxId:buffyBox.id,slot:1}));
  const found=await f.run(db=>storageSearch(db,f.maker,{q:c.ln}));
  const backup=found.rows.find(row=>row.storageType==='BACKUP')!,buffy=found.rows.find(row=>row.storageType==='BUFFY_COAT')!;
  expect(backup).toMatchObject({storageLabel:`${backup.lnHalos}-3`,retentionVerified:true,receivedAt:petReceipt.toISOString(),retentionDueAt:'2027-02-28T15:45:00.000Z'});
  expect(buffy).toMatchObject({storageLabel:buffy.lnHalos,retentionVerified:true,receivedAt:petReceipt.toISOString(),retentionDueAt:'2027-02-28T15:45:00.000Z'});
  const buffyPdf=await f.run(db=>storageSampleLabel(db,f.maker,{roundId:c.roundId,storageType:'BUFFY_COAT'})),buffyRead=await readStorageLabelPdf(buffyPdf);
  expect(buffyRead.pageCount).toBe(4);expect(buffyRead.text.split(buffy.storageLabel!).length-1).toBe(8);expect(buffyRead.text).toContain('BUFFY COAT');expect(buffyRead.text).toContain(`LN: ${c.ln}`);expect(buffyRead.barcodes).toEqual(Array(8).fill(buffy.storageLabel));expect(buffyRead.barCounts.every(count=>count%5===0)).toBe(true);expect(buffyRead.pages.every(([x0,y0,x1,y1])=>Math.abs(x1-x0-50/25.4*72)<0.01&&Math.abs(y1-y0-20/25.4*72)<0.01)).toBe(true);
  const backupPdf=await f.run(db=>storageSampleLabel(db,f.maker,{roundId:c.roundId,storageType:'BACKUP'})),backupRead=await readStorageLabelPdf(backupPdf);
  expect(backupRead.pageCount).toBe(4);expect(backupRead.text.split(backup.storageLabel!).length-1).toBe(8);expect(backupRead.text).toContain('BACKUP');expect(backupRead.barcodes).toEqual(Array(8).fill(backup.storageLabel));expect(backup.storageLabel).toMatch(/-3$/);expect(backup.storageLabel).not.toMatch(/-[12](?:$|\b)/);
  const boxPdf=await f.run(db=>storageLabel(db,f.maker,backupBox.id)),boxRead=await readStorageLabelPdf(boxPdf);
  expect(boxRead.text).toContain(backupBox.boxId);expect(boxRead.text).toContain('Backup Box');expect(boxRead.pageCount).toBe(1);expect(boxRead.barcodes).toHaveLength(0);
  const repeatPdf=await f.run(db=>storageSampleLabel(db,f.maker,{roundId:c.roundId,storageType:'BACKUP'}));expect((await readStorageLabelPdf(repeatPdf)).barcodes).toEqual(Array(8).fill(backup.storageLabel));
  await expect(f.run(db=>storageSampleLabel(db,f.u.anc,{roundId:c.roundId,storageType:'BACKUP'}))).rejects.toThrow('FORBIDDEN');
  await expect(f.run(db=>storageSearch(db,f.u.anc,{q:c.ln}))).rejects.toThrow('FORBIDDEN');
  expect((await f.db.query<{n:number}>("SELECT count(*)::int n FROM audit_chain WHERE action='LAB_STORAGE_SAMPLE_LABEL_PRINTED'")).rows[0].n).toBe(3);
 }finally{await f.close();}
});
it('LAB-UAT-003: local NIPT receipt does not start the PET retention clock',async()=>{
 const f=await histFixture();try{
  const c=await f.run(db=>syntheticCase(db,f.u));
  await f.run(db=>receiveS1(db,c,new Date('2026-10-20T01:00:00.000Z')));
  const redraw=await f.run(db=>orderRedraw(db,f.u.certifier,{caseId:c.caseId,reasonCode:'OTHER',note:'Synthetic unverified PET retention check'}));
  await f.run(db=>receiveRedraw(db,f.u.staff,{roundId:redraw.newRoundId,identityChecked:true,labelChecked:true,condition:'ACCEPTABLE',collectionDate:'2026-10-21'}));
  const history=await f.run(db=>storageSearch(db,f.maker,{q:c.ln,boxType:'BACKUP'}));
  const localRound=history.rows.find(row=>row.roundId===redraw.newRoundId);
  expect(localRound).toMatchObject({retentionVerified:false,retentionDueAt:null});
  expect(localRound?.receivedAt).not.toBeNull();
 }finally{await f.close();}
});
it('LAB-UAT-003: S1 storage remains searchable at its original slot after S2 and S3 PET rounds',async()=>{
 const f=await histFixture();try{
  const c=await f.run(db=>syntheticCase(db,f.u,{ln:'9903002912'})),s1At=new Date('2026-10-20T01:00:00.000Z');
  await f.run(db=>receiveS1(db,c,s1At));
  const box=await f.run(db=>storageCommand(db,f.maker,{action:'createBox',boxType:'BACKUP'}));
  await f.run(db=>storageCommand(db,f.maker,{action:'place',roundId:c.roundId,storageType:'BACKUP',boxId:box.id,slot:1}));
  const s2At=new Date('2026-10-21T02:00:00.000Z'),s2=await f.run(db=>orderRedraw(db,f.u.certifier,{caseId:c.caseId,reasonCode:'OTHER',note:'Synthetic S2 storage-history verification'}));
  await f.run(db=>receiveRedrawRound(db,c.lnId,s2.newRoundId,s2At));
  const s3At=new Date('2026-10-22T03:00:00.000Z'),s3=await f.run(db=>orderRedraw(db,f.u.certifier,{caseId:c.caseId,reasonCode:'OTHER',note:'Synthetic S3 storage-history verification'}));
  await f.run(db=>receiveRedrawRound(db,c.lnId,s3.newRoundId,s3At));
  const history=(await f.run(db=>storageSearch(db,f.maker,{q:c.ln,boxType:'BACKUP'}))).rows.sort((a,b)=>a.roundNumber-b.roundNumber);
  expect(history.map(row=>row.roundNumber)).toEqual([1,2,3]);
  expect(history.map(row=>row.receivedAt)).toEqual([s1At.toISOString(),s2At.toISOString(),s3At.toISOString()]);
  expect(history.map(row=>row.retentionDueAt)).toEqual(['2029-10-20T01:00:00.000Z','2029-10-21T02:00:00.000Z','2029-10-22T03:00:00.000Z']);
  expect(history[0]).toMatchObject({roundId:c.roundId,boxId:box.boxId,position:'A1',waiting:false});
  expect(history.slice(1).every(row=>row.waiting&&row.boxId===null)).toBe(true);
 }finally{await f.close();}
});
it('LAB-UAT-003: box and sample pagination disclose totals beyond 1,000 boxes without losing FIFO rows',async()=>{
 const f=await histFixture();try{
  await f.run(db=>storageCommand(db,f.maker,{action:'createBox',boxType:'BUFFY_COAT'}));
  await f.db.query(`INSERT INTO lab_storage_box(box_id,box_type,created_by)
   SELECT 'BoxPage'||lpad(n::text,4,'0'),'BACKUP',$1 FROM generate_series(1,1001) n`,[f.maker.id]);
  for(let i=0;i<13;i++){
   const sample=await f.run(db=>syntheticCase(db,f.u));
   await f.run(db=>receiveS1(db,sample,new Date(Date.UTC(2026,9,20,1,i))));
  }
  const boxes=await f.run(db=>storageSearch(db,f.maker,{boxType:'BACKUP'}));
  expect(boxes.boxTotal).toBe(1001);expect(boxes.boxTotalPages).toBe(21);expect(boxes.boxes).toHaveLength(50);
  const finalBoxPage=await f.run(db=>storageSearch(db,f.maker,{boxType:'BACKUP',boxPage:21}));
  expect(finalBoxPage.boxes).toHaveLength(1);expect(finalBoxPage.boxPage).toBe(21);
  const exact=await f.run(db=>storageSearch(db,f.maker,{boxType:'BACKUP',boxQuery:'BoxPage1001'}));
  expect(exact.boxTotal).toBe(1);expect(exact.boxes[0].boxId).toBe('BoxPage1001');
  const selectedBox=(await f.db.query<{id:string}>('SELECT id FROM lab_storage_box WHERE box_id=$1',['BoxPage1001'])).rows[0].id;
  const activeOutsidePage=await f.run(db=>storageSearch(db,f.maker,{boxType:'BACKUP',activeBoxId:selectedBox,boxPage:2}));
  expect(activeOutsidePage.activeBox?.boxId).toBe('BoxPage1001');
  const first=await f.run(db=>storageSearch(db,f.maker,{page:1,boxType:'ALL'})),second=await f.run(db=>storageSearch(db,f.maker,{page:2,boxType:'ALL'}));
  expect(first.total).toBe(26);expect(first.totalPages).toBe(2);expect(first.rows).toHaveLength(25);expect(second.rows).toHaveLength(1);
  const preview=await f.run(db=>storageCommand(db,f.maker,{action:'autoFillPreview',storageTypes:['BACKUP','BUFFY_COAT']}));
  expect(preview).toMatchObject({waiting:26,selected:26,planned:26,remaining:0});
  for(const type of ['BACKUP','BUFFY_COAT'] as const){const fifo=preview.placements.filter(p=>p.storageType===type).map(p=>p.receivedAt);expect(fifo).toEqual([...fifo].sort());}
 }finally{await f.close();}
});
it('LAB-UAT-003: sample pagination and FIFO Auto-fill explicitly expose the 10,000-row batch boundary',async()=>{
 const f=await histFixture();try{
  const fixture=await f.run(async db=>{
   await db.query(`CREATE TEMP TABLE task2_storage_large_fixture(
    n integer PRIMARY KEY,case_id uuid NOT NULL DEFAULT gen_random_uuid(),ln_id uuid NOT NULL DEFAULT gen_random_uuid(),
    round_id uuid NOT NULL DEFAULT gen_random_uuid(),inbound_id uuid NOT NULL DEFAULT gen_random_uuid(),ln text NOT NULL,
    received_at timestamptz NOT NULL,issue_date date NOT NULL,issue_sequence integer NOT NULL) ON COMMIT PRESERVE ROWS`);
   await db.query(`INSERT INTO task2_storage_large_fixture(n,ln,received_at,issue_date,issue_sequence)
    SELECT n,'9903'||lpad(n::text,6,'0'),
     timestamptz '2026-10-20 01:00:00+00'+((n-1)/900)::integer*interval '1 day'+((n-1)%900)::integer*interval '1 second',
     date '2026-10-20'+((n-1)/900)::integer,((n-1)%900)+1 FROM generate_series(1,10001) n`);
   await db.query(`INSERT INTO nipt_case(id,registration_origin,identity_key)
    SELECT case_id,'LAB_DIRECT',md5('TASK2-STORAGE-LARGE-A-'||n)||md5('TASK2-STORAGE-LARGE-B-'||n) FROM task2_storage_large_fixture`);
   await db.query(`INSERT INTO case_ln(id,case_id,ln,version,source)
    SELECT ln_id,case_id,ln,1,'LAB_ENTRY' FROM task2_storage_large_fixture`);
   await db.query(`INSERT INTO case_unit_scope(case_id,unit_id) SELECT case_id,$1 FROM task2_storage_large_fixture`,[f.u.unit]);
   await db.query(`INSERT INTO specimen_round(id,case_id,case_ln_id,round_number,state)
    SELECT round_id,case_id,ln_id,1,'Expected' FROM task2_storage_large_fixture`);
   await db.query(`UPDATE nipt_case c SET current_round_id=f.round_id FROM task2_storage_large_fixture f WHERE c.id=f.case_id`);
   await db.query(`INSERT INTO specimen_lab_number(round_id,case_id,ln_halos,sequence_date,sequence_value,issued_on,issue_path)
    SELECT round_id,case_id,p4_format_ln_halos(issue_date,issue_sequence),issue_date,issue_sequence,'HIS_PET_RECEIPT','RECEIPT_TRIGGER'
    FROM task2_storage_large_fixture`);
   await db.query(`INSERT INTO his_inbound_file(sha256,state)
    SELECT md5('TASK2-STORAGE-LARGE-FILE-A-'||n)||md5('TASK2-STORAGE-LARGE-FILE-B-'||n),'Applied(S1)' FROM task2_storage_large_fixture`);
   await db.query(`UPDATE task2_storage_large_fixture f SET inbound_id=i.id FROM his_inbound_file i
    WHERE i.sha256=md5('TASK2-STORAGE-LARGE-FILE-A-'||f.n)||md5('TASK2-STORAGE-LARGE-FILE-B-'||f.n)`);
   await db.query(`INSERT INTO his_order(case_ln_id,inbound_file_id,his_received_at,round_id)
    SELECT ln_id,inbound_id,received_at,round_id FROM task2_storage_large_fixture`);
   await db.query(`UPDATE specimen_round r SET received_at=f.received_at,received_source='HIS_PET_RECEIPT',state='ReceivedInHIS',collection_date=f.issue_date
    FROM task2_storage_large_fixture f WHERE r.id=f.round_id`);
   await db.query(`INSERT INTO lab_storage_box(box_id,box_type,created_by)
    SELECT 'BoxLarge'||lpad(n::text,3,'0'),'BACKUP',$1 FROM generate_series(1,124) n`,[f.maker.id]);
   return (await db.query<{round_id:string;ln:string;received_at:Date}>(`SELECT r.id round_id,l.ln,r.received_at FROM task2_storage_large_fixture f
    JOIN specimen_round r ON r.id=f.round_id JOIN case_ln l ON l.id=f.ln_id ORDER BY r.received_at,r.id LIMIT 1`)).rows[0];
  });
  const page=await f.run(db=>storageSearch(db,f.maker,{boxType:'BACKUP',page:1}));
  expect(page).toMatchObject({total:10001,totalPages:401,rows:expect.any(Array),boxTotal:124});expect(page.rows).toHaveLength(25);expect(page.boxes).toHaveLength(50);
  const preview=await f.run(db=>storageCommand(db,f.maker,{action:'autoFillPreview',storageTypes:['BACKUP']}));
  expect(preview).toMatchObject({waiting:10001,selected:10000,batchSize:10000,remaining:1,planned:10000,unplaced:0});
  expect(preview.placements[0]).toMatchObject({roundId:fixture.round_id,ln:fixture.ln,receivedAt:fixture.received_at.toISOString(),position:'A1'});
  expect(preview.placements.every((item,index,items)=>index===0||items[index-1].receivedAt!<=item.receivedAt!)).toBe(true);
 }finally{await f.close();}
});
it('LAB-UAT-003: actual cross-table occupancy blocks overwrite and unauthorized sample search is denied',async()=>{
 const f=await histFixture();try{
  const legacy=await f.run(db=>syntheticCase(db,f.u,{ln:'9903002921'})),typed=await f.run(db=>syntheticCase(db,f.u,{ln:'9903002922'}));
  await f.run(db=>receiveS1(db,legacy));await f.run(db=>receiveS1(db,typed));
  const box=await f.run(db=>storageCommand(db,f.maker,{action:'createBox',boxType:'BACKUP'}));
  const generic=(await f.db.query<{id:string}>(`INSERT INTO lab_storage_position(box_id,slot,round_id,stored_by) VALUES($1,1,$2,$3) RETURNING id`,[box.id,legacy.roundId,f.maker.id])).rows[0];
  const before=await f.run(db=>storageSearch(db,f.maker,{boxType:'BACKUP',activeBoxId:box.id}));
  expect(before.activeBox).toMatchObject({used:1,available:80,nextSlot:2});expect(before.activeBox?.grid[0]).toMatchObject({occupied:true,roundId:legacy.roundId,storageType:'LEGACY_UNCLASSIFIED'});expect(before.summary).toMatchObject({storedBackup:0,legacyStored:1});
  await expect(f.run(db=>storageCommand(db,f.maker,{action:'place',roundId:typed.roundId,storageType:'BACKUP',boxId:box.id,slot:1}))).rejects.toThrow('STORAGE_POSITION_OCCUPIED');
  await f.run(db=>storageCommand(db,f.maker,{action:'place',roundId:typed.roundId,storageType:'BACKUP',boxId:box.id,slot:2}));
  const after=await f.run(db=>storageSearch(db,f.maker,{boxType:'BACKUP',activeBoxId:box.id}));
  expect(after.activeBox?.used).toBe(2);expect(after.activeBox?.nextSlot).toBe(3);expect(after.summary).toMatchObject({storedBackup:1,legacyStored:1});
  expect((await f.db.query('SELECT 1 FROM lab_storage_position WHERE id=$1',[generic.id])).rows).toHaveLength(1);
  await expect(f.run(db=>storageSearch(db,f.u.anc,{q:legacy.ln}))).rejects.toThrow('FORBIDDEN');
 }finally{await f.close();}
});
it('LAB-UAT-003: auto-fill previews FIFO positions and repeat confirmation never duplicates placement',async()=>{
 const f=await histFixture();try{
  const oldest=await f.run(db=>syntheticCase(db,f.u));const newest=await f.run(db=>syntheticCase(db,f.u));
  await f.run(db=>receiveS1(db,newest,new Date('2026-10-20T02:00:00Z')));await f.run(db=>receiveS1(db,oldest,new Date('2026-10-20T01:00:00Z')));
  const box=await f.run(db=>storageCommand(db,f.maker,{action:'createBox',boxType:'BACKUP'}));
  const selectedPreview=await f.run(db=>storageCommand(db,f.maker,{action:'autoFillPreview',storageTypes:['BACKUP'],roundIds:[newest.roundId]}));
  expect(selectedPreview.placements.map(p=>p.roundId)).toEqual([newest.roundId]);
  const buffyBox=await f.run(db=>storageCommand(db,f.maker,{action:'createBox',boxType:'BUFFY_COAT'}));
  const preview=await f.run(db=>storageCommand(db,f.maker,{action:'autoFillPreview',storageTypes:['BACKUP','BUFFY_COAT']}));
  expect(preview.placements.map(p=>[p.storageType,p.roundId])).toEqual([['BACKUP',oldest.roundId],['BACKUP',newest.roundId],['BUFFY_COAT',oldest.roundId],['BUFFY_COAT',newest.roundId]]);
  expect(preview.waiting).toBe(4);expect(preview.planned).toBe(4);
  await f.run(db=>storageCommand(db,f.maker,{action:'autoFillConfirm',storageTypes:['BACKUP','BUFFY_COAT'],planHash:preview.planHash}));
  await expect(f.run(db=>storageCommand(db,f.maker,{action:'autoFillConfirm',storageTypes:['BACKUP','BUFFY_COAT'],planHash:preview.planHash}))).rejects.toThrow('STORAGE_PLAN_STALE');
  const stored=await f.db.query<{slot:number}>('SELECT slot FROM lab_storage_typed_position WHERE box_id=$1 ORDER BY slot',[box.id]);expect(stored.rows).toHaveLength(2);expect(stored.rows.map(r=>r.slot)).toEqual([1,2]);
  expect((await f.run(db=>storageSearch(db,f.maker,{q:oldest.ln,boxType:'BACKUP'}))).rows[0]).toMatchObject({position:'A1',waiting:false});
  const storedBuffy=await f.db.query('SELECT 1 FROM lab_storage_typed_position WHERE box_id=$1',[buffyBox.id]);expect(storedBuffy.rows).toHaveLength(2);
 }finally{await f.close();}
});
it('LAB-UAT-003: storage permission, unique position, exact box-label identity and LN/HN lookup',async()=>{
 const f=await histFixture();try{
  const c=await f.run(db=>registerP2(db,f.maker,{ln:'9903002901',hn:'9900042901',unitId:f.u.unit,origin:'LAB_DIRECT',identifierSource:'TUBE_LABEL',idempotencyKey:'storage_lab_uat_32_001'},Buffer.alloc(32,7),{store:f.store}));
  const round=(await f.db.query<{id:string}>('SELECT current_round_id id FROM nipt_case WHERE id=$1',[c.caseId])).rows[0].id;
  const lnId=(await f.db.query<{id:string}>('SELECT id FROM case_ln WHERE case_id=$1',[c.caseId])).rows[0].id;
  await f.run(db=>receiveS1(db,{roundId:round,lnId}));
  const box=await f.run(db=>storageCommand(db,f.maker,{action:'createBox',boxType:'BACKUP'}));
  await expect(f.run(db=>storageCommand(db,f.u.anc,{action:'place',roundId:round,storageType:'BACKUP',boxId:box.id,slot:1}))).rejects.toThrow('FORBIDDEN');
  await f.run(db=>storageCommand(db,f.maker,{action:'place',roundId:round,storageType:'BACKUP',boxId:box.id,slot:10}));
  await expect(f.run(db=>storageCommand(db,f.maker,{action:'place',roundId:round,storageType:'BACKUP',boxId:box.id,slot:2}))).rejects.toThrow('STORAGE_POSITION_OCCUPIED');
  const found=await f.run(db=>storageSearch(db,f.maker,{q:'9900042901',boxType:'BACKUP'}));expect(found.rows[0]).toMatchObject({position:'A2',boxId:'Box001',storageType:'BACKUP'});
  expect((await f.run(db=>storageLabel(db,f.maker,box.id))).subarray(0,5).toString()).toBe('%PDF-');
  expect(authorize(f.maker,'settings.read',{},'read')).toBe(false);expect(authorize(f.u.anc,'settings.read',{},'read')).toBe(false);
 }finally{await f.close();}
});
it('LAB-UAT-008/011/012/013/014/016: same operator completes, corrects and replaces only one PDF; original evidence and clinical HOLD retained',async()=>{
 const f=await histFixture();try{
  const r=goodRow(901),batch=await importBatch(f,[r],[{name:r.pdf_file!,bytes:pdfFor(r)}]);let d=(await view(f,batch)).rows[0];const file=d.pdfName;
  const done=await f.run(db=>reviewManual(db,f.maker,f.store,{draftId:d.id,version:d.version,lnMatchesOriginal:true,pdfBindingMatchesOriginal:true,identityMatchesOriginal:true,identityIdentifiersChecked:['HN','NAME'],finalPdfReviewed:true}));expect(done.current).toBe(true);
  expect((await f.run(db=>getBatch(db,f.maker,batch,{q:r.hn}))).manualSummary.done).toBe(1);
  await f.run(db=>replaceRowPdf(db,f.maker,f.store,d.id,d.version,{name:'new.pdf',bytes:pdfFor(r,{labNumber:'9999999999'})}));
  const changed=await view(f,batch);d=changed.rows[0];expect(d.issues.some(i=>i.code==='PDF_LN_DIFFERS'&&i.severity==='ERROR')).toBe(true);expect(changed.manualSummary.done).toBe(0);
  expect(changed.files.some(f=>f.original_name===file)).toBe(true);
  expect((await f.db.query('SELECT 1 FROM historical_draft_revision WHERE draft_id=$1',[d.id])).rows).toHaveLength(2);
  expect((await f.db.query('SELECT 1 FROM result_release')).rows).toHaveLength(0);
 }finally{await f.close();}
});
