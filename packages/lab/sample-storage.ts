import {z} from 'zod';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import type {Queryable} from '../db/connection';
import {assertSession,need,uuid,audit,LabError,type Staff} from './core';
export const storagePosition=(slot:number)=>`${'ABCDEFGHI'[(slot-1)%9]}${Math.floor((slot-1)/9)+1}`;
export async function storageSearch(db:Queryable,user:Staff,raw:unknown){
 await assertSession(db,user);need(user,'worksheet.read','read');
 const d=z.object({q:z.string().trim().max(80).default(''),page:z.coerce.number().int().min(1).max(100000).default(1)}).parse(raw);
 const where=`($1='' OR strpos(lower(l.ln),lower($1))>0 OR strpos(lower(i.hn),lower($1))>0 OR strpos(lower(coalesce(n.ln_halos,'')),lower($1))>0 OR strpos(lower(coalesce(b.box_id,'')),lower($1))>0)`;
 const from=`FROM specimen_round r JOIN case_ln l ON l.id=r.case_ln_id JOIN p2_case_identity i ON i.case_id=r.case_id LEFT JOIN specimen_lab_number n ON n.round_id=r.id LEFT JOIN lab_storage_position p ON p.round_id=r.id LEFT JOIN lab_storage_box b ON b.id=p.box_id`;
 const total=Number((await db.query<{n:string}>(`SELECT count(*)::text n ${from} WHERE ${where}`,[d.q])).rows[0].n),page=Math.min(d.page,Math.max(1,Math.ceil(total/25)));
 const rows=(await db.query<{round_id:string;ln:string;hn:string;ln_halos:string|null;round_number:number;box_id:string|null;box_uuid:string|null;slot:number|null}>(`SELECT r.id round_id,l.ln,i.hn,n.ln_halos,r.round_number,b.box_id,b.id box_uuid,p.slot ${from} WHERE ${where} ORDER BY r.id LIMIT 25 OFFSET $2`,[d.q,(page-1)*25])).rows;
 const boxes=(await db.query<{id:string;box_id:string;used:number}>(`SELECT b.id,b.box_id,count(p.id)::int used FROM lab_storage_box b LEFT JOIN lab_storage_position p ON p.box_id=b.id GROUP BY b.id HAVING count(p.id)<81 ORDER BY b.box_number DESC LIMIT 100`)).rows;
 return {rows:rows.map(r=>({...r,position:r.slot?storagePosition(r.slot):null})),boxes,page,total,totalPages:Math.max(1,Math.ceil(total/25))};
}
export async function storageCommand(db:Queryable,user:Staff,raw:unknown){
 await assertSession(db,user);need(user,'batch.assign');
 const d=z.discriminatedUnion('action',[z.strictObject({action:z.literal('createBox')}),z.strictObject({action:z.literal('store'),roundId:uuid,boxId:uuid,slot:z.number().int().min(1).max(81)})]).parse(raw);
 if(d.action==='createBox'){
  const n=(await db.query<{n:string}>("SELECT nextval('lab_storage_box_box_number_seq')::text n")).rows[0].n;
  const id=(await db.query<{id:string}>(`INSERT INTO lab_storage_box(box_number,box_id,created_by) OVERRIDING SYSTEM VALUE VALUES($1,$2,$3) RETURNING id`,[n,`Box${n.padStart(3,'0')}`,user.id])).rows[0].id;
  await audit(db,user,'LAB_STORAGE_BOX_CREATED','lab_storage_box',id,{outcome:'CREATED'});return{id};
 }
 await db.query('SELECT id FROM lab_storage_box WHERE id=$1 FOR UPDATE',[d.boxId]);
 if(!(await db.query('SELECT id FROM specimen_round WHERE id=$1',[d.roundId])).rows.length)throw new LabError('NOT_FOUND',404);
 const existing=(await db.query('SELECT id FROM lab_storage_position WHERE round_id=$1 OR (box_id=$2 AND slot=$3)',[d.roundId,d.boxId,d.slot])).rows;
 if(existing.length)throw new LabError('STORAGE_POSITION_OCCUPIED',409);
 const id=(await db.query<{id:string}>('INSERT INTO lab_storage_position(round_id,box_id,slot,stored_by) VALUES($1,$2,$3,$4) RETURNING id',[d.roundId,d.boxId,d.slot,user.id])).rows[0].id;
 await audit(db,user,'LAB_SAMPLE_STORED','lab_storage_position',id,{outcome:'RECORDED'});return{id};
}
export async function storageLabel(db:Queryable,user:Staff,boxId:string){
 await assertSession(db,user);need(user,'label.print');
 const b=(await db.query<{id:string;box_id:string}>('SELECT id,box_id FROM lab_storage_box WHERE id=$1',[uuid.parse(boxId)])).rows[0];if(!b)throw new LabError('NOT_FOUND',404);
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.HelveticaBold),page=pdf.addPage([240,100]);page.drawText(b.box_id,{x:16,y:48,size:24,font});page.drawText('NIPT-CBH / Sample Storage',{x:16,y:22,size:11,font});
 await audit(db,user,'LAB_STORAGE_LABEL_PRINTED','lab_storage_box',b.id,{outcome:'ORIGINAL_OR_REPRINT'});return Buffer.from(await pdf.save());
}
