import {operationalDataEnabled} from './runtime';
export const ROLES = ["ANC_NURSE", "ANC_SUPERVISOR", "LAB_STAFF", "LAB_CERTIFIER", "CLINICAL_APPROVER", "APP_ADMIN", "IT_OPERATOR", "AUDITOR", "HISTORICAL_VERIFIER"] as const;
export type Role = typeof ROLES[number];
export type Principal = { id: string; roles: readonly Role[]; unitIds: readonly string[]; permissions: readonly string[] };
type Cell = "-" | "Y" | "U" | "R" | "P" | "A" | "L" | "C" | "B";
// Source: Plan §7.2, AL-1/OD-04/OD-13. C remains denied pending a scoped policy decision.
// Eight original matrix columns, followed by separate Historical Verifier permission.
const rows = {
  "case.register.anc": "UU-------",
  "case.register.lab": "--YY-----",
  "intake.link": "--PA---R-",
  "history.draft": "--CY---R-",
  "history.promote": "--CCC--RA",
  "history.read": "CCYY-B-RY",
  "history.send": "-------R-",
  "history.withdraw": "--PA---R-",
  "attempt.resume": "--YY---R-",
  "request.edit": "UULL-----",
  "request.correct": "UUYY---R-",
  "clinical.correct": "---YY--R-",
  "clinical.sop": "---CC--R-",
  "consent.prepare": "UULL-----",
  "consent.sign.patient": "---------",
  "paper.verify": "CCCY---R-",
  "round.collect": "UUYY---R-",
  "round.attest": "CCCY C--R-".replaceAll(" ", ""),
  "consent.withdraw.receive": "UUYY---R-",
  "consent.withdraw.decide": "---PA--R-",
  "doctor.manage": "-P--AP-R-",
  "case.read": "UUYYYB-R-",
  "document.request.read": "UUYYYB---",
  "his.scan": "--YY-YYR-",
  "his.conflict.resolve": "--PA---R-",
  "specimen.hold": "--YY---R-",
  "specimen.accept": "--CC---R-",
  "label.print": "--YY-----",
  "batch.assign": "--YY---R-",
  "batch.unlock": "---Y---R-",
  "batch.draft": "--YY---R-",
  "batch.finalize": "--YY---R-",
  "execution.record": "--YY---R-",
  "batch.amend": "--CY---R-",
  "observation.transcribe": "--YY---R-",
  "observation.verify": "--CY---R-",
  "observation.discrepancy": "--PY---R-",
  "document.recall": "--PY---R-",
  "handoff.create": "--YY---R-",
  "handoff.verify": "--YY---R-",
  "handoff.exception": "---PA--R-",
  "document.obsolete.print": "---Y---Y-",
  "downtime.incident": "---A-PPR-",
  "downtime.recover": "--CP---R-",
  "downtime.approve": "---A---R-",
  "downtime.form.register": "--YY---R-",
  "qc.accept": "--CY---R-",
  "slot.disposition": "--PA---R-",
  "qc.record": "--YY---R-",
  "pool.crosscheck": "--YY---R-",
  "pool.approve": "--CY---R-",
  "worksheet.read": "--YY---R-",
  "worksheet.revise": "--PY---R-",
  "material.manage": "--YY---R-",
  "formula.change": "---PA--R-",
  "repeat.order": "--YY---R-",
  "redraw.order": "--CY---R-",
  "redraw.after.release": "---CC--R-",
  "redraw.cancel": "--PY---R-",
  "round.receive": "--YY---R-",
  "result.import": "--YY-----",
  "result.link.manual": "--PA---R-",
  // P5: attesting parsed values against the PDF, and evaluating RG/RN in the certifying transaction. Release itself stays
  // `result.certify` / `notice.release`, which remain denied below until AL-5.
  "result.review": "--YY---R-",
  "result.release.check": "---Y---R-",
  "result.certify": "---Y---R-",
  "notice.release": "--CY---R-",
  "result.revise": "--PY---R-",
  "result.read.released": "UUYY-B---",
  "result.read.obsolete": "--YY---R-",
  "his.retry": "--YY-Y-R-",
  "his.reconcile": "--YY--YR-",
  "integration.configure": "-----YYR-",
  "his.production.enable": "----APPR-",
  "res.profile.change": "--P-AP-R-",
  "clinical.rules.change": "---PA--R-",
  "history.cutoff.change": "---PA--R-",
  "user.manage": "----AY-R-",
  "settings.read": "--RRRYRY-",
  "audit.read": "--RRRYRYY",
  "report.export": "-UYY---R-",
  "backup.manage": "------YR-",
  "health.read": "--YYYYYYY",
  "settings.general.change": "-----Y---",
  "settings.integration.propose": "-----PP--",
  "settings.clinical.propose": "---P-----",
  "settings.approve": "----A----",
  "secret.write": "-----YY--",
  // Run Photo Evidence (migration 103): optional evidence of a Run, readable with the Lab worksheet. LAB_STAFF manage their
  // own uploads; LAB_CERTIFIER may correct any upload (service rule). The storage path is an installation/admin concern.
  "photo.read": "--YY---R-",
  "photo.upload": "--YY-----",
  "photo.manage": "--YY-----",
  "photo.storage.configure": "-----YY--"
} as const;
export const PERMISSION_MATRIX = rows;
export type Action = keyof typeof rows;
export type ResourceScope = { unitId?: string; origin?: "ANC" | "LAB_DIRECT" | "HISTORICAL"; actorId?: string; assignedUserId?: string; state?: string };
export type Operation = "read" | "write" | "propose" | "approve";

export function authorize(user: Principal, action: string, resource: ResourceScope = {}, operation: Operation = "write"): boolean {
  if (!(action in rows) || !user.roles.length) return false;
  // P1 runtime never enables actual outputs, signing on someone's behalf, historical processing, or certification.
  if (["consent.sign.patient", "his.production.enable", "history.send", "redraw.after.release"].includes(action)) return false;
  if(["result.certify","notice.release"].includes(action)&&!operationalDataEnabled())return false;
  // P5H: history.promote is no longer hard-denied; only the matrix 'A' (approve) cell of HISTORICAL_VERIFIER grants it, and the service additionally
  // requires an active, approved historical_backfill + go_live_cutoff setting, so it stays inert (fail closed) until the Owner decides OD-18/OD-27.
  if (resource.origin === "HISTORICAL" && !["history.read", "audit.read"].includes(action)) return false;
  if (["observation.verify", "handoff.verify", "settings.approve", "downtime.approve", "result.link.manual", "his.conflict.resolve"].includes(action) && resource.actorId === user.id) return false;
  const rule = rows[action as Action];
  return user.roles.some(role => {
    const cell = rule[ROLES.indexOf(role)] as Cell;
    if (cell === "Y") return true;
    if (cell === "U") {
      if (!resource.unitId) return false;
      // OD-13 explicitly granted cross-unit ANC VIEW only; no implied write scope.
      return user.unitIds.includes(resource.unitId) || (operation === "read" && user.permissions.includes("ANC_VIEW_ALL_UNITS"));
    }
    if (cell === "R") return operation === "read";
    if (cell === "P") return operation === "propose";
    if (cell === "A") return operation === "approve";
    if (cell === "L") return resource.origin === "LAB_DIRECT";
    if (cell === "C" && action === "history.draft") return user.permissions.includes("HISTORICAL_ENTRY");
    return false; // unresolved policy and break-glass are not implicit rights.
  });
}

export function requirePermission(user: Principal, action: string, resource?: ResourceScope, operation?: Operation): void {
  if (!authorize(user, action, resource, operation)) throw new Error("FORBIDDEN");
}
