import { describe,it,expect } from "vitest";
import { ROLES, PERMISSION_MATRIX, authorize, type Principal } from "../../packages/security/policy";
const blocked = new Set(["consent.sign.patient", "his.production.enable", "history.send", "history.promote", "result.certify", "notice.release", "redraw.after.release"]);
describe("every role × action × scope × operation cell",()=>{
  for(const [action,rule] of Object.entries(PERMISSION_MATRIX)) for(const [index,role] of ROLES.entries()) {
    it(`${role} / ${action}`,()=>{
      expect(rule).toHaveLength(ROLES.length);
      const user:Principal={id:"maker",roles:[role],unitIds:["own"],permissions:[]};
      for(const operation of ["read","write","propose","approve"] as const) for(const unitId of ["own","other",undefined]) {
        const cell=rule[index];
        const expected=!blocked.has(action)&&(cell==="Y"||(cell==="U"&&unitId==="own")||(cell==="R"&&operation==="read")||(cell==="P"&&operation==="propose")||(cell==="A"&&operation==="approve"));
        expect(authorize(user,action,{unitId,origin:"ANC",actorId:"someone-else"},operation)).toBe(expected);
      }
    });
  }
  it("Admin never inherits PHI, certifier, breakglass or unknown permissions",()=>{
    const admin:Principal={id:"admin",roles:["APP_ADMIN"],unitIds:[],permissions:[]};
    for(const action of ["case.read","result.certify","result.read.released","made-up"]) expect(authorize(admin,action,{unitId:"x"})).toBe(false);
  });
  it("OD13 requires explicit all-unit grant, read only",()=>{
    const anc:Principal={id:"anc",roles:["ANC_NURSE"],unitIds:["own"],permissions:["ANC_VIEW_ALL_UNITS"]};
    expect(authorize(anc,"case.read",{unitId:"other"},"read")).toBe(true);
    expect(authorize(anc,"request.edit",{unitId:"other"},"write")).toBe(false);
  });
  it("preparer limited to lab-direct; no user signs as patient",()=>{
    const lab:Principal={id:"lab",roles:["LAB_STAFF"],unitIds:[],permissions:[]};
    expect(authorize(lab,"consent.prepare",{origin:"LAB_DIRECT"})).toBe(true);
    expect(authorize(lab,"consent.prepare",{origin:"ANC"})).toBe(false);
    for(const role of ROLES) expect(authorize({...lab,roles:[role]},"consent.sign.patient")).toBe(false);
  });
  it("maker-checker denies self approval and historical clinical children",()=>{
    const checker:Principal={id:"same",roles:["CLINICAL_APPROVER"],unitIds:[],permissions:[]};
    expect(authorize(checker,"settings.approve",{actorId:"same"},"approve")).toBe(false);
    expect(authorize({...checker,roles:["LAB_CERTIFIER"]},"batch.assign",{origin:"HISTORICAL"})).toBe(false);
  });
});
