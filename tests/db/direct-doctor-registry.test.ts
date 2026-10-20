import {beforeAll,afterAll,it,expect} from 'vitest';
import {testDatabase,addUser} from '../helpers/database';
import type {PGlite} from '@electric-sql/pglite';
import {doctorAction,listDoctors,doctorUnits,activeDoctor,registerP2,type Staff} from '../../packages/p2/service';
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
it('shares doctors across units without broadening patient access, and denies unauthorized management',async()=>{
 const saved=await tx(()=>doctorAction(db,anc,{...input(),doctorKey:'SYNTHETIC-OTHER',unitId:other}));
 expect(await activeDoctor(db,String(saved.id),unit)).toMatchObject({unit_id:other});
 expect((await listDoctors(db,anc)).find(d=>'id' in d&&d.id===saved.id)).toMatchObject({active:true});
 expect((await doctorUnits(db,anc)).some(u=>u.id===other)).toBe(true);
 await expect(tx(()=>registerP2(db,anc,{ln:'9900001010',hn:'9900001',unitId:other,origin:'ANC',idempotencyKey:'SYNTHETIC_SHARED_DOCTOR_DENIED'},Buffer.alloc(32,7)))).rejects.toThrow('FORBIDDEN');
 const lab=await addUser(db,'LAB_STAFF','synthetic.lab');await expect(tx(()=>doctorAction(db,lab,{...input(),doctorKey:'SYNTHETIC-LAB'}))).rejects.toThrow('FORBIDDEN');
 await expect(tx(()=>doctorAction(db,anc,{...input(),doctorKey:'SYNTHETIC-NO-AUTH',authorized:false}))).rejects.toThrow();
});
it('lets ANC explicitly activate a legacy pending record by saving it, while legacy approval stays restricted',async()=>{
 const old=await tx(()=>doctorAction(db,admin,{action:'propose',doctorKey:'SYNTHETIC-LEGACY',name:'SYNTHETIC legacy test',unitId:unit,effectiveFrom:'2020-01-01T00:00:00Z',authorization:'SYNTHETIC test fixture',vector:fixture.vector}));
 await expect(activeDoctor(db,String(old.id),unit)).rejects.toMatchObject({code:'AUTHORIZED_SYNTHETIC_DOCTOR_REQUIRED'});
 await expect(tx(()=>doctorAction(db,anc,{action:'approve',id:old.id,reason:'SYNTHETIC denied legacy path'}))).rejects.toMatchObject({code:'FORBIDDEN'});
 const updated=await tx(()=>doctorAction(db,anc,{action:'save',id:old.id,doctorKey:'SYNTHETIC-LEGACY',name:'SYNTHETIC legacy test',unitId:unit,authorized:true}));
 expect(await activeDoctor(db,String(updated.id),unit)).toMatchObject({signature_png:fixture.png});
 expect(await activeDoctor(db,String(updated.id),other)).toMatchObject({signature_png:fixture.png});
});
it('validates bytes, MIME, image dimensions and base64 instead of trusting extensions',async()=>{
 await expect(uploadedDoctorSignature({mime:'image/jpeg',data:fixture.png})).rejects.toMatchObject({code:'SIGNATURE_IMAGE_INVALID'});
 await expect(uploadedDoctorSignature({mime:'image/png',data:Buffer.from('<svg/>').toString('base64')})).rejects.toMatchObject({code:'SIGNATURE_IMAGE_INVALID'});
 const bomb=Buffer.from(fixture.png,'base64');bomb.writeUInt32BE(90000,16);await expect(uploadedDoctorSignature({mime:'image/png',data:bomb.toString('base64')})).rejects.toMatchObject({code:'SIGNATURE_IMAGE_SIZE'});
});
