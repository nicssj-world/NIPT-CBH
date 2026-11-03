import {it,expect,vi,afterEach} from "vitest";
import {resultFixture,receivedCase} from "../helpers/results";
import {acceptSpecimen} from "../../packages/lab/intake";
afterEach(()=>vi.unstubAllEnvs());
const png="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRE0AAAAASUVORK5CYII=";
it("UI-010 optional rejection photo is stored securely and atomically; empty photo list is accepted",async()=>{
 const f=await resultFixture();try{
  vi.stubEnv("NIPT_MODE","operational");vi.stubEnv("APP_ORIGIN","https://nipt.test");
  await f.db.query("UPDATE nipt_runtime_config SET mode='operational'");
  const c=await receivedCase(f);
  const r=await f.run(db=>acceptSpecimen(db,f.u.staff,{roundId:c.roundId,condition:"REJECTED",reasonCode:"TUBE_LABEL_MISMATCH",photos:[{mime:"image/png",data:png}]}));
  expect(r).toMatchObject({condition:"REJECTED",photoCount:1});
  const evidence=(await f.db.query<{media_type:string;length:number;actor_id:string;sequence:number}>("SELECT media_type,octet_length(content)::int length,actor_id,sequence FROM specimen_rejection_evidence WHERE acceptance_id=$1",[(r as {id:string}).id])).rows;
  expect(evidence).toHaveLength(1);
  expect(evidence[0]).toMatchObject({media_type:"image/png",actor_id:f.u.staff.id,sequence:1});
  expect(evidence[0].length).toBeGreaterThan(32);
  const c2=await receivedCase(f);
  const r2=await f.run(db=>acceptSpecimen(db,f.u.staff,{roundId:c2.roundId,condition:"REJECTED",reasonCode:"VOLUME_INSUFFICIENT"}));
  expect(r2).toMatchObject({condition:"REJECTED",photoCount:0});
  expect((await f.db.query("SELECT 1 FROM specimen_rejection_evidence WHERE acceptance_id=$1",[(r2 as {id:string}).id])).rows).toHaveLength(0);
 }finally{await f.close();}
},120000);
