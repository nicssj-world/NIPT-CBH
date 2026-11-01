import { describe,it,expect } from "vitest";
import { ROLES, PERMISSION_MATRIX, APP_ADMIN_RESTRICTED_ACTIONS, APP_ADMIN_SYSTEMWIDE_ACTIONS, authorize, type Action, type Principal } from "../../packages/security/policy";
const blocked = new Set(["consent.sign.patient", "his.production.enable", "history.send", "result.certify", "notice.release", "redraw.after.release"]);
describe("every role × action × scope × operation cell",()=>{
  for(const [action,rule] of Object.entries(PERMISSION_MATRIX)) for(const [index,role] of ROLES.entries()) {
    it(`${role} / ${action}`,()=>{
      expect(rule).toHaveLength(ROLES.length);
      const user:Principal={id:"maker",roles:[role],unitIds:["own"],permissions:[]};
      for(const operation of ["read","write","propose","approve"] as const) for(const unitId of ["own","other",undefined]) {
        const cell=rule[index];
        const adminGrant=role==="APP_ADMIN"&&APP_ADMIN_SYSTEMWIDE_ACTIONS.has(action as Action);
        const expected=!blocked.has(action)&&(adminGrant||cell==="Y"||(cell==="U"&&unitId==="own")||(cell==="R"&&operation==="read")||(cell==="P"&&operation==="propose")||(cell==="A"&&operation==="approve"));
        expect(authorize(user,action,{unitId,origin:"ANC",actorId:"someone-else"},operation)).toBe(expected);
      }
    });
  }
  it("P5H: only the Historical Verifier can approve a promotion; nobody can send historical results to HIS",()=>{
    const p=(roles:Principal["roles"]):Principal=>({id:"u",roles,unitIds:[],permissions:["HISTORICAL_ENTRY"]});
    expect(authorize(p(["HISTORICAL_VERIFIER"]),"history.promote",{},"approve")).toBe(true);
    for(const role of ROLES.filter(r=>r!=="HISTORICAL_VERIFIER"))for(const op of ["write","propose","approve"] as const)expect(authorize(p([role]),"history.promote",{},op)).toBe(false);
    expect(authorize(p(["HISTORICAL_VERIFIER"]),"history.promote",{},"write")).toBe(false);
    for(const role of ROLES)for(const op of ["read","write","propose","approve"] as const)expect(authorize(p([role]),"history.send",{},op)).toBe(false);
    expect(authorize(p(["LAB_STAFF"]),"history.draft",{},"write")).toBe(true);
    expect(authorize({...p(["LAB_STAFF"]),permissions:[]},"history.draft",{},"write")).toBe(true);
  });
  it("single APP_ADMIN (owner 2026-11-01) holds clinical/lab sign-off actions, but never patient signing, promotion, unknown actions or self-approval",()=>{
    const admin:Principal={id:"admin",roles:["APP_ADMIN"],unitIds:[],permissions:[]};
    for(const action of ["case.read","result.read.released","worksheet.read","settings.read"]) expect(authorize(admin,action,{unitId:"x"},"read")).toBe(true);
    for(const action of ["observation.verify","qc.accept","pool.approve","clinical.correct","settings.approve","result.revise","handoff.verify","his.conflict.resolve"]) expect(authorize(admin,action,{unitId:"x",actorId:"other"},"approve")).toBe(true);
    for(const action of ["consent.sign.patient","history.promote","his.production.enable","history.send","redraw.after.release","made-up"]) expect(authorize(admin,action,{unitId:"x",actorId:"other"},"approve")).toBe(false);
    // maker-checker: the administrator cannot check their own work
    for(const action of ["observation.verify","handoff.verify","settings.approve","downtime.approve","result.link.manual","his.conflict.resolve"]) expect(authorize(admin,action,{actorId:"admin"},"approve")).toBe(false);
    // certification follows the operational switch for everyone, the administrator included
    for(const action of ["result.certify","notice.release"]) expect(authorize(admin,action,{},"approve")).toBe(false);
  });
  it("classifies every permission exactly once for the system-wide Admin role",()=>{
    const all=new Set<Action>([...APP_ADMIN_SYSTEMWIDE_ACTIONS,...APP_ADMIN_RESTRICTED_ACTIONS]);
    expect(APP_ADMIN_SYSTEMWIDE_ACTIONS.size+APP_ADMIN_RESTRICTED_ACTIONS.size).toBe(all.size);
    expect(all).toEqual(new Set(Object.keys(PERMISSION_MATRIX) as Action[]));
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
