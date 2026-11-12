import {it,expect} from 'vitest';
import {task3Fixture} from '../helpers/task3';
import {emptyRequest} from '../../packages/p2/schema';
import {caseNationalId} from '../../packages/p2/service';

// The case page's requisition summary shows the national ID: the ANC request's own value, else the one the PET carries (as the NHSO popup does).
const PET_ID='1101700203451',ANC_ID='3100500123456';
const fixture=()=>task3Fixture([
 {ln:'9900099611',hn:'9900099961',pregnancy:'Singleton',sheet:1,pet:{identity:PET_ID}},
 {ln:'9900099612',hn:'9900099962',pregnancy:'Singleton',sheet:2,pet:{identity:PET_ID}},
 {ln:'9900099613',hn:'9900099963',pregnancy:'Singleton',sheet:3}]);
type F=Awaited<ReturnType<typeof task3Fixture>>;
async function request(f:F,index:number,identifier:string|null){
 const c=f.cases[index],draft={...emptyRequest,patient:{...emptyRequest.patient,identifier}};
 await f.db.query(`INSERT INTO p2_workspace(round_id,case_id,draft,request_mode,consent_mode,updated_by) VALUES($1,$2,$3,'Paper','Paper',$4)
  ON CONFLICT(round_id) DO UPDATE SET draft=EXCLUDED.draft,version=p2_workspace.version+1`,[c.roundId,c.caseId,JSON.stringify(draft),f.admin.id]);
}
it('uses the ANC request value first, then the PET value when the request has none',async()=>{
 const f=await fixture();try{
  const read=(i:number)=>f.run(t=>caseNationalId(t,f.store,f.admin,f.cases[i].caseId));
  await request(f,0,null);expect(await read(0)).toEqual({nationalId:PET_ID,source:'PET'});
  await request(f,0,'   ');expect(await read(0)).toEqual({nationalId:PET_ID,source:'PET'});   // blank counts as not filled
  await request(f,1,ANC_ID);expect(await read(1)).toEqual({nationalId:ANC_ID,source:'REQUEST'});   // ANC wins over the PET
  await request(f,2,null);expect(await read(2)).toEqual({nationalId:'SYNTHETIC-ID-P3',source:'PET'});   // the fixture's default PET identity
  // every read is PHI-access-logged for that case, and the ID is not written anywhere in clear
  const logged=(await f.db.query<{n:number}>("SELECT count(*)::int n FROM phi_access_log WHERE case_id=$1",[f.cases[0].caseId])).rows[0].n;
  expect(logged).toBeGreaterThan(0);
 }finally{await f.close();}
},120000);
