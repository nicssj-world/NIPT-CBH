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
 * Printed Sample ID per analytical attempt. Only the legacy-supported paths are generated:
 * attempt 1 of a specimen round = Normal (`-1`), the first Re-Library repeat = `-2`.
 * Anything else (Re-extraction, a second Re-Library, …) has no Owner-approved format (OD-03 / AT-IDPAR-09):
 * return null so the attempt cannot be finalized with an invented identifier.
 */
export type RepeatLevel = "RE_LIBRARY" | "RE_EXTRACTION";
export function printedSampleId(input: { base: string; pregnancy: "Singleton" | "Twins" | "Unknown" | null; attemptNumber: number; repeatLevel: RepeatLevel | null; earlierReLibraryCount: number; roundNumber?:number; receivedSource?:string|null }) {
  const code = effectiveLnHalos(input.base, input.pregnancy);
  if(input.receivedSource==='HIS_PET_RECEIPT'&&(input.roundNumber??1)>1){
    if(input.roundNumber!==2||input.attemptNumber!==1||input.repeatLevel!==null)return null;
    return formatRunSampleId(code,'Re-Sampling');
  }
  if (input.attemptNumber === 1 && input.repeatLevel === null) return formatRunSampleId(code, "Normal");
  if (input.attemptNumber > 1 && input.repeatLevel === "RE_LIBRARY" && input.earlierReLibraryCount === 0) return formatRunSampleId(code, "Re-Library");
  return null;
}
