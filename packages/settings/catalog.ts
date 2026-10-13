import { z } from "zod";
const pathValue = z.string().min(1).max(500).refine(x => !/[\r\n\0]/.test(x), "INVALID_PATH");
export const SETTINGS = {
  general: { category: "General", risk: "GENERAL", schema: z.object({ systemName: z.string().min(1).max(80), timezone: z.literal("Asia/Bangkok") }).strict(), default: { systemName: "NIPT CBH", timezone: "Asia/Bangkok" } },
  request_consent: { category: "ANC/Request & Consent", risk: "CLINICAL", schema: z.object({ templateVersion: z.string().min(1), mode: z.enum(["ELECTRONIC", "PAPER", "MIXED"]) }).strict(), default: { templateVersion: "synthetic-v1", mode: "PAPER" } },
  doctor_registry: { category: "ANC Doctors", risk: "CLINICAL", schema: z.object({ version: z.string().min(1) }).strict(), default: { version: "synthetic-v1" } },
  security: { category: "User/Role/Permission", risk: "SECURITY", schema: z.object({ idleMinutes: z.literal(30), absoluteHours: z.literal(8), lockoutAttempts: z.literal(5), lockoutMinutes: z.literal(15) }).strict(), default: { idleMinutes: 30, absoluteHours: 8, lockoutAttempts: 5, lockoutMinutes: 15 } },
  his_inbound: { category: "HIS Inbound", risk: "INTEGRATION", schema: z.object({ enabled: z.boolean(), basePath: pathValue, section: z.literal("7"), testCode: z.literal("70096"), intervalSeconds: z.number().int().min(5).max(3600), lookbackDays: z.number().int().min(1).max(90), secretRef: z.string().uuid().nullable() }).strict(), default: { enabled: false, basePath: "simulator/inbound", section: "7", testCode: "70096", intervalSeconds: 30, lookbackDays: 7, secretRef: null } },
  laboratory: { category: "Laboratory", risk: "CLINICAL", schema: z.object({ templateVersion: z.string().min(1), formulaVersion: z.string().min(1), partialBatchAllowed: z.literal(true), halosDataRows: z.literal(47), pendingGovernanceGate: z.enum(["HOLD", "PROCEED_SYNTHETIC_LABELLED"]).optional() }).strict(), default: { templateVersion: "synthetic-v1", formulaVersion: "unvalidated", partialBatchAllowed: true, halosDataRows: 47 } },
  // P5: NIPTY-style folder intake (path + Test Path + Scan) plus the browser picker. Literal fields record Owner decisions that remain
  // HOLD (OD-05/07/09/17, AL-5); they are displayed but cannot be changed. P5 fields default so earlier P1 revisions remain readable.
  result_management: { category: "Result Management", risk: "CLINICAL", schema: z.object({ picVersion: z.string().min(1), maxUploadMb: z.number().int().min(1).max(25),
    pdfSourcePath: pathValue.default("simulator/results"), scanSubfolders: z.boolean().default(true), acceptZip: z.boolean().default(true), maxFilesPerScan: z.number().int().min(1).max(2000).default(500),
    // A23 (Owner 2026-10-13): NIPTY auto_scan_min kept as a listing-only schedule; 0 = off. It never imports, links, certifies or releases.
    scheduledScanMinutes: z.number().int().refine(v => v === 0 || (v >= 5 && v <= 1440), "SCHEDULED_SCAN_0_OR_5_TO_1440").default(0),
    gaToleranceDays: z.number().int().min(0).max(14).default(7), linkageMode: z.literal("MANUAL_REVIEWED_ONLY").default("MANUAL_REVIEWED_ONLY"),
    certificationMethod: z.literal("PENDING_OD05").default("PENDING_OD05"), sexDisclosureRule: z.literal("PROPOSED_BLOCK_UNLESS_WANTED_OD09").default("PROPOSED_BLOCK_UNLESS_WANTED_OD09"),
    postReleaseRecollection: z.literal("PENDING_OD17_VOID_FIRST").default("PENDING_OD17_VOID_FIRST"), noticeChannel: z.literal("NIPT_ONLY_PENDING_OD07").default("NIPT_ONLY_PENDING_OD07"),
    releaseAuthority: z.literal("HOLD_AL5").default("HOLD_AL5") }).strict(),
    default: { picVersion: "unvalidated", maxUploadMb: 10, pdfSourcePath: "simulator/results", scanSubfolders: true, acceptZip: true, maxFilesPerScan: 500, scheduledScanMinutes: 0, gaToleranceDays: 7, linkageMode: "MANUAL_REVIEWED_ONLY", certificationMethod: "PENDING_OD05", sexDisclosureRule: "PROPOSED_BLOCK_UNLESS_WANTED_OD09", postReleaseRecollection: "PENDING_OD17_VOID_FIRST", noticeChannel: "NIPT_ONLY_PENDING_OD07", releaseAuthority: "HOLD_AL5" } },
  his_outbound: { category: "HIS Outbound/CFS", risk: "INTEGRATION", schema: z.object({ enabled: z.boolean(), target: z.literal("SIMULATOR"), productionAuthorized: z.literal(false), resultStyle: z.enum(["full", "short", "fixed"]), retryLimit: z.number().int().min(1).max(10), round2SpecimenDatePolicy: z.null() }).strict(), default: { enabled: false, target: "SIMULATOR", productionAuthorized: false, resultStyle: "full", retryLimit: 5, round2SpecimenDatePolicy: null } },
  storage_backup: { category: "Storage/NAS/Backup", risk: "INTEGRATION", schema: z.object({ retentionDays: z.number().int().min(1).max(3650), target: z.literal("SIMULATOR") }).strict(), default: { retentionDays: 30, target: "SIMULATOR" } },
  notifications: { category: "Notifications/System/Audit", risk: "GENERAL", schema: z.object({ staleSeconds: z.number().int().min(60).max(3600), backlogWarning: z.number().int().min(1).max(10000) }).strict(), default: { staleSeconds: 90, backlogWarning: 10 } },
  go_live_cutoff: { category: "Result Management", risk: "CLINICAL", schema: z.object({ cutoff: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), impactReportHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(), default: null }
} as const;
export type SettingKey = keyof typeof SETTINGS;
export function settingDefinition(key: string) {
  if (!(key in SETTINGS)) throw new Error("UNKNOWN_OR_LOCKED_SETTING");
  return SETTINGS[key as SettingKey];
}
