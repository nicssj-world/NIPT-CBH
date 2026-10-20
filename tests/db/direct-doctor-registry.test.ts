import {beforeAll,afterAll,it,expect} from 'vitest';
import {testDatabase,addUser} from '../helpers/database';
import type {PGlite} from '@electric-sql/pglite';
import {doctorAction,listDoctors,activeDoctor,type Staff} from '../../packages/p2/service';
import {deriveSignature} from '../../packages/p2/signature';
import {uploadedDoctorSignature} from '../../packages/p2/doctor-registry';
let db:PGlite,anc:Staff,admin:Staff,unit:string,other:string;
// Automated fixture only: geometric test strokes, never represented as a person's authorized signature.
const fixture=deriveSignature({width:600,height:200,strokes:[[[10,10],[80,90],[180,30]]]}),key='SYNTHETIC-DIRECT-DR';
async function tx<T>(fn:()=>Promise<T>){await db.query('BEGIN');try{const r=await fn();await db.query('COMMIT');return r;}catch(e){await db.query('ROLLBACK');throw e;}}
beforeAll(async()=>{db=await testDatabase();admin=await addUser(db);anc=await addUser(db,'ANC_NURSE','synthetic.anc');unit=(await db.query<{id:string}>("INSERT INTO unit(code,name) VALUES('OWN','Own') RETURNING id")).rows[0].id;other=(await db.query<{id:string}>("INSERT INTO unit(code,name) VALUES('OTHER','Other') RETURNING id")).rows[0].id;anc.unitIds=[unit];});afterAll(async()=>db.close());
const input=()=>({action:'save',doctorKey:key,name:'SYNTHETIC Doctor Test',unitId:unit,authorized:true,image:{mime:'image/png',data:fixture.png}});
it('ANC saves an uploaded signature directly, immediately available in the same registry as Admin',async()=>{
 const saved=await tx(()=>doctorAction(db,anc,input()));
 expect(await activeDoctor(db,String(saved.id),unit)).toMatchObject({signature_png:fixture.png,signature_hash:fixture.hash});
 expect((await listDoctors(db,anc)).find(d=>'id' in d&&d.id===saved.id)).toMatchObject({active:true});
 expect((await listDoctors(db,admin)).find(d=>'id' in d&&d.id===saved.id)).toMatchObject({active:true});
 const old=(await db.query('SELECT * FROM p2_doctor_version WHERE id=$1',[saved.id])).rows[0];
 const changed=await tx(()=>doctorAction(db,anc,{...input(),image:undefined,id:saved.id,name:'SYNTHETIC Doctor Updated'}));
 expect(changed.version).toBe(2);expect((await db.query('SELECT * FROM p2_doctor_version WHERE id=$1',[saved.id])).rows[0]).toEqual(old);
 await expect(activeDoctor(db,String(saved.id),unit)).rejects.toMatchObject({code:'AUTHORIZED_SYNTHETIC_DOCTOR_REQUIRED'});
 await expect(tx(()=>doctorAction(db,anc,{...input(),id:saved.id}))).rejects.toMatchObject({code:'DOCTOR_RECORD_CHANGED'});
});
it('denies cross-unit mutations, non-staff authority and missing authorization',async()=>{
 await expect(tx(()=>doctorAction(db,anc,{...input(),doctorKey:'SYNTHETIC-OTHER',unitId:other}))).rejects.toMatchObject({code:'FORBIDDEN'});
 const lab=await addUser(db,'LAB_STAFF','synthetic.lab');await expect(tx(()=>doctorAction(db,lab,{...input(),doctorKey:'SYNTHETIC-LAB'}))).rejects.toThrow('FORBIDDEN');
 await expect(tx(()=>doctorAction(db,anc,{...input(),doctorKey:'SYNTHETIC-NO-AUTH',authorized:false}))).rejects.toThrow();
});
it('validates bytes, MIME, image dimensions and base64 instead of trusting extensions',async()=>{
 await expect(uploadedDoctorSignature({mime:'image/jpeg',data:fixture.png})).rejects.toMatchObject({code:'SIGNATURE_IMAGE_INVALID'});
 await expect(uploadedDoctorSignature({mime:'image/png',data:Buffer.from('<svg/>').toString('base64')})).rejects.toMatchObject({code:'SIGNATURE_IMAGE_INVALID'});
 const bomb=Buffer.from(fixture.png,'base64');bomb.writeUInt32BE(90000,16);await expect(uploadedDoctorSignature({mime:'image/png',data:bomb.toString('base64')})).rejects.toMatchObject({code:'SIGNATURE_IMAGE_SIZE'});
});
