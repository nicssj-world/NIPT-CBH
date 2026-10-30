// P4 laboratory identifiers. Every generated format below is Owner-locked to Genomic-CBH parity
// (NIPT_CBH_Genomic_CBH_Number_Generation_Parity_2026-10-11; legacy lib/nipt/rules.ts @44ce3f4).
// tests/unit/p4-parity.test.ts compares these functions with the vendored legacy source, not with memory.
export const BANGKOK_TIME_ZONE = "Asia/Bangkok";
export const LN_HALOS_PATTERN = /^[0-9]{2}B[0-9]{9}$/;

export const CONTROL_SLOTS = { 1: "positive", 25: "negative", 40: "blank" } as const;
export type ControlType = (typeof CONTROL_SLOTS)[keyof typeof CONTROL_SLOTS];
export const CONTROL_LABEL: Record<ControlType, string> = { positive: "PC", negative: "NC", blank: "BLANK" };
export const SLOT_COUNT = 48;
export const SHEET_SLOT_RANGES = { 1: [1, 16], 2: [17, 32], 3: [33, 48] } as const;
export type SheetNumber = keyof typeof SHEET_SLOT_RANGES;
export const PATIENT_SLOTS = Array.from({ length: SLOT_COUNT }, (_, i) => i + 1).filter(slot => !(slot in CONTROL_SLOTS));

export function formatBangkokDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: BANGKOK_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? "";
  return { year: get("year"), month: get("month"), day: get("day") };
}
export function formatBangkokIsoDate(date = new Date()) {
  const { year, month, day } = formatBangkokDateParts(date);
  return `${year}-${month}-${day}`;
}
/** `YYBYYMMDDNNN`: Gregorian 2-digit year twice around the B marker, Bangkok calendar day, monthly 001–999. */
export function formatLnHalos(sequence: number, date = new Date()) {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 999) throw new Error("LN Halos monthly sequence must be between 1 and 999");
  const { year, month, day } = formatBangkokDateParts(date);
  return `${year.slice(-2)}B${year.slice(-2)}${month}${day}${String(sequence).padStart(3, "0")}`;
}
/** Legacy effective LN Halos: Twin appends `D` once for display/print; the stored base never changes. */
export function effectiveLnHalos(base: string, pregnancy: "Singleton" | "Twins" | "Unknown" | null) {
  if (!LN_HALOS_PATTERN.test(base)) throw new Error("INVALID_LN_HALOS");
  return pregnancy === "Twins" ? `${base}D` : base;
}

export function formatControlCode(type: ControlType, isoDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return "";
  const [year, month, day] = isoDate.split("-");
  const marker = type === "positive" ? "1" : type === "negative" ? "2" : "3";
  return `${year.slice(-2)}N${marker}${year}${month}${day}`;
}
/** Task List prints control IDs with a fixed `-1` (legacy task-sheet-template buildTaskSheetSourceRows). */
export function formatPrintedControlId(type: ControlType, isoDate: string) {
  const code = formatControlCode(type, isoDate);
  return code ? `${code}-1` : "";
}

/**
 * Owner Lock OD-R1/OD-R1a: the specimen code shown on screens and tube labels is BASE, BASED (Twins), BASER (redraw S2
 * received via HIS PET) or BASEDR (Twins redraw) — D before R. `isResampling` comes from data (the S2 LN Halos row reuses
 * the S1 base: specimen_lab_number.original_round_id), never from inspecting a string. Accepts only an unsuffixed base
 * (effectiveLnHalos rejects anything else), so a suffix can never be applied twice. The stored base never changes.
 */
export function specimenDisplayCode(base: string, pregnancy: "Singleton" | "Twins" | "Unknown" | null, isResampling: boolean) {
  return `${effectiveLnHalos(base, pregnancy)}${isResampling ? RUN_SUFFIX["Re-Sampling"] : ""}`;
}

/** Analytical run-type suffixes. NOT the tube-label `-1/-2/-3` composition (AT-LABEL-06). */
export const RUN_SUFFIX = { Normal: "-1", "Re-Library": "-2", "Re-Sampling": "R" } as const;
export type RunType = keyof typeof RUN_SUFFIX;
export function formatRunSampleId(lnHalos: string, runType: RunType) {
  return `${lnHalos}${RUN_SUFFIX[runType]}`;
}

export function getSheetNumber(slot: number): SheetNumber {
  if (!Number.isInteger(slot) || slot < 1 || slot > SLOT_COUNT) throw new Error("Plate slot must be between 1 and 48");
  return slot <= 16 ? 1 : slot <= 32 ? 2 : 3;
}
export function getPlatePosition(slot: number) {
  getSheetNumber(slot);
  return `${"ABCDEFGH"[(slot - 1) % 8]}${Math.floor((slot - 1) / 8) + 1}`;
}
/** Workbook Task List columns F/L: the preprinted Barcode index equals the global slot number 1–48. */
export function getBarcodeIndex(slot: number) {
  getSheetNumber(slot);
  return slot;
}
export function controlTypeOf(slot: number): ControlType | null {
  return (CONTROL_SLOTS as Record<number, ControlType>)[slot] ?? null;
}
export function formatRunLabel(runNumber: number, year: number) {
  if (!Number.isInteger(runNumber) || runNumber < 1 || !Number.isInteger(year)) throw new Error("INVALID_RUN_NUMBER");
  return `Run${String(runNumber).padStart(3, "0")}/${year}`;
}
/** Printed strip sub-labels `RunNNN S1-n/3` / `RunNNN S2-n/3` from legacy task-sheet-template. */
export function stripLabels(runLabel: string, sheet: SheetNumber) {
  const run = runLabel.split("/")[0] || runLabel;
  return { s1: `${run} S1-${sheet}/3`, s2: `${run} S2-${sheet}/3` };
}

/**
 * Task 1 Owner lock 2026-10-23. Analytical IDs are deliberately nonunique;
 * persisted case/round/attempt lineage, never this display text, identifies work.
 */
export type RepeatLevel = "RE_LIBRARY" | "RE_EXTRACTION";
export function printedSampleId(input: { base: string; pregnancy: "Singleton" | "Twins" | "Unknown" | null; attemptNumber: number; repeatLevel: RepeatLevel | null; earlierReLibraryCount: number; roundNumber?:number; receivedSource?:string|null; overallOrdinal?:number }) {
  const round=input.roundNumber??1;
  if(!Number.isInteger(round)||round<1||!Number.isInteger(input.attemptNumber)||input.attemptNumber<1)return null;
  if(round>1&&input.receivedSource!=='HIS_PET_RECEIPT')return null;
  const code=specimenDisplayCode(input.base,input.pregnancy,round>1);
  const ordinal=input.overallOrdinal??(round===1?input.attemptNumber:undefined);
  if(ordinal!==undefined&&(!Number.isInteger(ordinal)||ordinal<1))return null;
  if(ordinal!==undefined&&ordinal>=5)return `${specimenDisplayCode(input.base,input.pregnancy,true)}-1`;
  if(input.attemptNumber===1&&input.repeatLevel===null)return `${code}-1`;
  if((input.attemptNumber===2||round>1&&input.attemptNumber>2)&&(input.repeatLevel==='RE_LIBRARY'||input.repeatLevel==='RE_EXTRACTION'))return `${code}-2`;
  return null;
}
