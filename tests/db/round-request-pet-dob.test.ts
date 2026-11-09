import {it,expect} from 'vitest';
import {task3Fixture} from '../helpers/task3';
import {roundRequest} from '../../packages/results/service';

// Owner 2026-11-09: the link comparison showed "วันเกิด: ไม่มีข้อมูล" for a Lab paper case. A case matched to a PET always has a date of birth
// (the PET carries it), so the request side falls back to the PET's date of birth. The request's own date of birth still comes first.
it('the request-side date of birth falls back to the PET when the paper check has none, and a typed one still wins',async()=>{
 const f=await task3Fixture();try{
  const c=f.cases[0];
  const dob=async()=>(await roundRequest(f.db,c.roundId)).dob;
  expect(await dob()).toBe('1990-01-01');                                  // no request evidence at all: the PET (already the case before)
  // the short paper request check carries GA, doctor and pregnancy type but no date of birth
  await f.db.query("INSERT INTO p2_workspace(round_id,case_id,draft,request_mode,consent_mode,updated_by) VALUES($1,$2,'{}','Paper','Paper',$3) ON CONFLICT(round_id) DO NOTHING",[c.roundId,c.caseId,f.admin.id]);
  const review=(panel:object,at:string)=>f.db.query(`INSERT INTO p2_paper_review(case_id,round_id,kind,template_version,document_reference,panel,status,location,reason,verifier_id,created_at)
   VALUES($1,$2,'REQUEST','CBH-FM01-v1','SYNTHETIC-PAPER',$3,'Verified','SYNTHETIC','SYNTHETIC_TEST',$4,${at})`,[c.caseId,c.roundId,JSON.stringify(panel),f.admin.id]);
  await review({gaWeeks:17,gaDays:6,pregnancyType:'Singleton'},'now()');
  expect(await dob()).toBe('1990-01-01');                                  // was null before this change
  await review({gaWeeks:17,gaDays:6,pregnancyType:'Singleton',dob:'1990-01-02'},"now()+interval '1 second'");
  expect(await dob()).toBe('1990-01-02');                                  // a date typed on the request is not overridden
 }finally{await f.close();}
},600000);
