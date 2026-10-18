// Field Inventory SEED for F2/F3 (Plan v6.2.1 Appendix F.4, Workbook New_Task_List_Edit (2).xlsx, WI-T-BM16/18).
// Status: SEED — UNVERIFIED. AT-EXPORT-02 may report only "not yet confirmed" until Lab + QA sign the inventory (R6-M05).
export const FIELD_INVENTORY_STATUS = "SEED_UNVERIFIED_F4";
export type FieldClass = "CI" | "CN" | "PR";
export type FieldKind = "TRANSFER" | "CHECK" | "TEXT" | "DATE" | "LOT" | "TIME_RANGE" | "NUMBER";
// `optional`: recordable on the sheet but never needed for completeness (informational).
export type FieldDef = { id: string; item: string; form: "F2" | "F3"; scope: "SHEET" | "SLOT" | "BATCH"; kind: FieldKind; cls: FieldClass; label: string; source: string; required: (sheet: number) => boolean; optional?: boolean };
const always = () => true;
const f2 = (id: string, item: string, kind: FieldKind, cls: FieldClass, label: string, source: string, required: (sheet: number) => boolean = always, scope: FieldDef["scope"] = "SHEET"): FieldDef => ({ id, item, form: "F2", scope, kind, cls, label, source, required });

export const FIELDS: FieldDef[] = [
  // OD-S (Owner 2026-10-18): F2-02 = actual Library Preparation date (B4). Control IDs stay on the planned date locked at execution start (OD-T);
  // a different actual date needs a short reason (OD-E). F2-03 = actual DNA Extraction date, information only, bound to no master cell.
  f2("F2-02", "", "DATE", "PR", "วันที่ทำ Library Preparation จริง", "TL!A4:B4"),
  { ...f2("F2-03", "", "DATE", "PR", "วันที่ทำ DNA Extraction จริง (ข้อมูลประกอบ ไม่ใช้สร้างรหัส)", "— (ไม่มีช่องใน Master)"), optional: true },
  f2("F2-05", "", "TEXT", "PR", "ผู้ปฏิบัติงานจริง", "TL!I5"),
  f2("F2-11", "", "TRANSFER", "CI", "✓ ตรวจ Lab number บนหลอดเทียบ Task List ก่อน/หลังดูดลง Strip", "TL!E9:E16, K9:K16; WI-T-BM16 §10.5", always, "SLOT"),
  f2("F2-13", "", "LOT", "PR", "Extraction Lot no. / Exp. date ที่ใช้จริง", "TL!A17"),
  f2("F2-14", "", "LOT", "PR", "Library Lot no. / Exp. date ที่ใช้จริง", "TL!A18"),
  f2("F2-15", "PRECLEAN", "CHECK", "PR", "เปิดเครื่อง MGISP-100 และ Pre-clean (Cf-WI-T-BM18-01)", "TL!A20; WI-T-BM18 §10.1"),
  f2("F2-16", "LYSIS", "CHECK", "PR", "Lysis buffer", "TL!A23"),
  f2("F2-16", "WASH1", "CHECK", "PR", "Wash buffer 1", "TL!A24"),
  f2("F2-16", "WASH2", "CHECK", "PR", "Wash buffer 2", "TL!A25"),
  f2("F2-16", "MILLIQ", "CHECK", "PR", "เตรียม MilliQ (ตำแหน่ง Control ของ Task List นี้)", "TL!A26"),
  f2("F2-16", "BEAD1", "CHECK", "PR", "Magnetic Bead 1: วางที่อุณหภูมิห้อง 30 min", "TL!E23"),
  f2("F2-16", "BEAD2_733", "CHECK", "PR", "Magnetic Bead 2 (733 μL): วางที่อุณหภูมิห้อง 30 min", "TL!E24"),
  f2("F2-16", "BEAD2_580", "CHECK", "PR", "Magnetic Bead 2 (580 μL): วางที่อุณหภูมิห้อง 30 min", "TL!E25"),
  f2("F2-16", "ETHANOL75", "CHECK", "PR", "เตรียม 75% Ethanol (Cf-WI-T-BM18-01)", "TL!E26"),
  f2("F2-16", "ELUTION", "CHECK", "PR", "Elution buffer", "TL!K23"),
  f2("F2-17", "", "CHECK", "PR", "แบ่งน้ำยาลง 96-Deepwell plate ตาม layout (NIFTY_LowThroughtput_DNAExtraction)", "TL!A28:A29"),
  f2("F2-18", "", "CHECK", "PR", "Post clean (Cf-WI-T-BM18-01)", "TL!A31; WI-T-BM18 §10.4"),
  f2("F2-19", "BEADS_740", "CHECK", "PR", "แบ่ง Magnetic Beads 740 μL ลง screw cap 2 mL (Position 5C)", "TL!A38"),
  f2("F2-19", "BEADS_910", "CHECK", "PR", "แบ่ง Magnetic Beads 910 μL ลง screw cap 2 mL (Position 5D)", "TL!F38"),
  f2("F2-20", "DEEPWELL", "CHECK", "PR", "แบ่งน้ำยาลง 96-Deepwell plate (Library)", "TL!A40"),
  f2("F2-20", "BARCODE_STRIPS", "CHECK", "CI", "Barcode 2 strips ตรงกับแผนผังตัวอย่าง", "TL!A42"),
  f2("F2-21", "", "CHECK", "PR", "Dilute Control 1:31 (3 μL control + 93 μL MilliQ)", "TL1/TL2!A45", sheet => sheet !== 3),
  f2("F2-22", "BREAKAWAY", "CHECK", "PR", "เตรียม break away plate 4 strip (Library product 2, Dilute barcode 2)", "TL!A47:A49"),
  f2("F2-22", "VORTEX", "CHECK", "PR", "Vortex + Spin down ทุกน้ำยา", "TL!A50"),
  f2("F2-22", "ENZYME", "CHECK", "PR", "หยิบ Enzyme (End repair + Ligase) → Spin down (Ice box)", "TL!A51"),
  f2("F2-23", "", "CHECK", "PR", "นำ Strip Plate Product มาวัด QC", "TL!A54"),
  f2("F2-24", "", "TIME_RANGE", "PR", "เวลาเริ่ม/จบ Script (เสนอ — ยืนยันใน P0)", "WI-T-BM18"),
  { id: "F3-03", item: "", form: "F3", scope: "SLOT", kind: "NUMBER", cls: "CN", label: "Concentration (ng/µL)", source: "QC!C7:C54", required: always },
  { id: "F3-05", item: "STD1", form: "F3", scope: "BATCH", kind: "NUMBER", cls: "CN", label: "Standard 1", source: "QC!D19", required: always },
  { id: "F3-05", item: "STD2", form: "F3", scope: "BATCH", kind: "NUMBER", cls: "CN", label: "Standard 2", source: "QC!D20", required: always },
  { id: "F3-01", item: "OPERATOR", form: "F3", scope: "BATCH", kind: "TEXT", cls: "PR", label: "ผู้ปฏิบัติงาน QC", source: "QC!F3", required: always },
];
export const fieldKey = (id: string, item: string) => `${id}${item ? ":" + item : ""}`;
export function fieldDef(id: string, item = ""): FieldDef {
  const def = FIELDS.find(f => f.id === id && f.item === item);
  if (!def) throw new Error("FIELD_NOT_IN_INVENTORY");
  return def;
}
/** Required sheet-scope F2 fields (everything except the per-slot transfer check). */
export const requiredSheetFields = (sheet: number) => FIELDS.filter(f => f.form === "F2" && f.scope === "SHEET" && f.required(sheet) && !f.optional);
