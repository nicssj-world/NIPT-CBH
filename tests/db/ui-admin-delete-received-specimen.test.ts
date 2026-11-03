import {it,expect} from "vitest";
import {resultFixture,receivedCase} from "../helpers/results";
import {addUser} from "../helpers/database";
import {voidIncorrectRegistration,getCase,listP2Cases} from "../../packages/p2/service";

// Owner 2026-11-03: an administrator deletes a received, not-yet-analysed specimen in one step (no reason, no typing). The case disappears from the lists and its
// Ready attempt from every queue; analysis, results and signed consent still block everyone. (EQA registrations are removed through eqa_delete_registration.)
it("APP_ADMIN deletes a received specimen before analysis; Lab staff cannot; analysis blocks the delete",async()=>{
 const f=await resultFixture();try{
  const admin=await addUser(f.db,"APP_ADMIN","synthetic.delete.admin");
  const ident=async(caseId:string)=>(await f.db.query<{ln:string;hn:string}>("SELECT l.ln,i.hn FROM nipt_case c JOIN case_ln l ON l.case_id=c.id JOIN p2_case_identity i ON i.case_id=c.id WHERE c.id=$1",[caseId])).rows[0];
  const del=(caseId:string,who=admin)=>f.run(async t=>{const x=await ident(caseId);return voidIncorrectRegistration(t,who,caseId,{expectedLn:x.ln,expectedHn:x.hn});});

  const a=await receivedCase(f,{ln:'9900002001'});
  expect((await f.run(t=>getCase(t,admin,a.caseId))).allowedActions).toContain("case.registration.void");   // the case page offers it
  await expect(del(a.caseId,f.u.staff)).rejects.toThrow();                                                  // Lab staff cannot

  expect(await del(a.caseId)).toMatchObject({voided:true});
  expect((await f.db.query<{state:string}>("SELECT state FROM analytical_attempt WHERE case_id=$1",[a.caseId])).rows.map(r=>r.state)).toEqual(["Cancelled"]);   // out of every queue
  expect((await f.run(t=>listP2Cases(t,admin,{q:'9900002001'}))).cases.some(c=>c.id===a.caseId)).toBe(false);                                              // out of the registry
  expect((await f.db.query("SELECT 1 FROM specimen_lab_number WHERE case_id=$1",[a.caseId])).rows).toHaveLength(1);                                      // the number stays with the tombstone

  const b=await receivedCase(f,{ln:'9900002002'});                // analysis started: nobody can delete it
  await f.db.query("UPDATE analytical_attempt SET state='Assigned' WHERE case_id=$1",[b.caseId]);
  await expect(del(b.caseId)).rejects.toThrow("REGISTRATION_HAS_DOWNSTREAM_EVIDENCE");
  expect((await f.run(t=>getCase(t,admin,b.caseId))).allowedActions).not.toContain("case.registration.void");
 }finally{await f.close();}
},180000);
