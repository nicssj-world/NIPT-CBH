import {describe,it,expect} from "vitest";
import {authorize,type Principal} from "../../packages/security/policy";

const admin:Principal={id:"system-admin",roles:["APP_ADMIN"],unitIds:[],permissions:[]};

describe("APP_ADMIN system-wide workspace access",()=>{
 it("reads ANC and LAB resources across units and origins",()=>{
  for(const [action,origin] of [["case.read","ANC"],["document.request.read","ANC"],["result.read.released","ANC"],["worksheet.read","LAB_DIRECT"],["history.read","HISTORICAL"]] as const){
   expect(authorize(admin,action,{unitId:"other-unit",origin},"read"),action).toBe(true);
  }
 });

 it("can use non-sign-off workspace APIs without inheriting clinical approval identities",()=>{
  for(const action of ["case.register.anc","case.register.lab","his.scan","batch.draft","execution.record","photo.read","report.export","settings.read"]){
   expect(authorize(admin,action,{},action==="settings.read"?"read":"write"),action).toBe(true);
  }
  for(const action of ["consent.sign.patient","observation.verify","handoff.verify","pool.approve","qc.accept","result.certify","notice.release","result.revise","history.promote","settings.approve","downtime.approve","his.production.enable","history.send","redraw.after.release"]){
   expect(authorize(admin,action,{actorId:"someone-else"},"approve"),action).toBe(false);
  }
  expect(authorize(admin,"unknown.permission")).toBe(false);
 });

 it("does not add Admin workspace permissions to ANC or LAB staff",()=>{
  const anc:Principal={...admin,id:"anc",roles:["ANC_NURSE"]};
  const lab:Principal={...admin,id:"lab",roles:["LAB_STAFF"]};
  expect(authorize(anc,"worksheet.read",{},"read")).toBe(false);
  expect(authorize(lab,"settings.read",{},"read")).toBe(false);
  expect(authorize(lab,"observation.verify",{},"approve")).toBe(false);
 });

 it("keeps a separately assigned certifier identity usable",()=>{
  const certifier:Principal={...admin,id:"certifier",roles:["LAB_CERTIFIER"]};
  expect(authorize(certifier,"observation.verify",{},"write")).toBe(true);
 });
});
