import {it,expect} from "vitest";
import {testDatabase,addUser} from "../helpers/database";
import {doctorAction,listDoctors,activeDoctor} from "../../packages/p2/service";

it("UI-005 doctor Active/Inactive is an audited reversible event and preserves stored doctor version",async()=>{
 const db=await testDatabase();
 try{
  const admin=await addUser(db,"APP_ADMIN","synthetic.ui005-admin");
  const unit=(await db.query<{id:string}>("INSERT INTO unit(code,name) VALUES('U005','UI-005') RETURNING id")).rows[0].id;
  const saved=await doctorAction(db,admin,{action:"save",doctorKey:"SYNTHETIC-UI005-DOCTOR",name:"SYNTHETIC Doctor",unitId:unit});
  const id=String(saved.id);
  expect((await listDoctors(db,admin)).find(d=>"id" in d&&d.id===id)?.active).toBe(true);
  await doctorAction(db,admin,{action:"status",id,active:false});
  expect((await listDoctors(db,admin)).find(d=>"id" in d&&d.id===id)?.active).toBe(false);
  await expect(activeDoctor(db,id,unit)).rejects.toThrow("DOCTOR_NOT_AVAILABLE");
  await doctorAction(db,admin,{action:"status",id,active:true});
  expect((await listDoctors(db,admin)).find(d=>"id" in d&&d.id===id)?.active).toBe(true);
  expect((await db.query<{n:number}>("SELECT count(*)::int n FROM p2_doctor_event WHERE doctor_version_id=$1 AND event_type IN ('Suspended','Approved')",[id])).rows[0].n).toBeGreaterThanOrEqual(3);
  expect((await db.query<{n:number}>("SELECT count(*)::int n FROM p2_doctor_version WHERE id=$1",[id])).rows[0].n).toBe(1);
 }finally{await db.close();}
},120000);

it("UI-005 editing an inactive doctor must preserve Inactive until explicitly reactivated",async()=>{
 const db=await testDatabase();
 try{
  const admin=await addUser(db,"APP_ADMIN","synthetic.ui005-edit");
  const unit=(await db.query<{id:string}>("INSERT INTO unit(code,name) VALUES('U005B','UI-005B') RETURNING id")).rows[0].id;
  const doctorKey="SYNTHETIC-UI005-EDIT";
  const first=await doctorAction(db,admin,{action:"save",doctorKey,name:"SYNTHETIC Original",unitId:unit});
  const id=String(first.id);
  await doctorAction(db,admin,{action:"status",id,active:false});
  const next=await doctorAction(db,admin,{action:"save",id,doctorKey,name:"SYNTHETIC Edited",unitId:unit});
  expect(next.status).toBe("Suspended");
  expect((await listDoctors(db,admin)).find(d=>"id" in d&&d.id===next.id)?.active).toBe(false);
  await doctorAction(db,admin,{action:"status",id:String(next.id),active:true});
  expect((await listDoctors(db,admin)).find(d=>"id" in d&&d.id===next.id)?.active).toBe(true);
 }finally{await db.close();}
},120000);
