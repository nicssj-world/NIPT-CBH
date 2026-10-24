import { z } from "zod";
import {operationalProfileSchema} from '../p6/res';
const pathValue = z.string().min(1).max(500).refine(x => !/[\r\n\0]/.test(x), "INVALID_PATH");
// Must equal packages/readygen/interpretation RULESET_SHA256 (asserted by unit test); kept literal so this module stays dependency-free.
export const REPORT_RULESET_SHA256 = "05c7c43c4e0078004155a14f0d87181153b10684861f80b621a5e5e283e9f3a0";
export const REPORT_PRODUCT_CHOICES = ["NONE", "HNZ0010", "HNZ0011", "HNZ0020", "HNZ0021", "HNZ0040", "HNZ0041", "HNZ0050", "HNZ0051"] as const;
export const SETTINGS = {
  general: { category: "General", risk: "GENERAL", schema: z.object({ systemName: z.string().min(1).max(80), timezone: z.literal("Asia/Bangkok") }).strict(), default: { systemName: "NIPT CBH", timezone: "Asia/Bangkok" } },
  // OD-06 consumer (2026-10-18): templateVersion selects the installed, hash-verified DCC template set used by the ANC form preview.
  request_consent: { category: "ANC/Request & Consent", risk: "CLINICAL", schema: z.object({ templateVersion: z.string().min(1).max(64), mode: z.enum(["ELECTRONIC", "PAPER", "MIXED"]) }).strict(), default: { templateVersion: "CBH-BM17-REF-2026-10-18", mode: "PAPER" } },
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
    gaToleranceDays: z.number().int().min(0).max(14).default(7), // Owner P5-A (2026-10-18, migration 100): UNIQUE_AUTO_LINK lets the system link a single clean match; MANUAL_REVIEWED_ONLY keeps two people.
    linkageMode: z.enum(["MANUAL_REVIEWED_ONLY","UNIQUE_AUTO_LINK"]).default("MANUAL_REVIEWED_ONLY"),
    certificationMethod: z.literal("PENDING_OD05").default("PENDING_OD05"), sexDisclosureRule: z.literal("PROPOSED_BLOCK_UNLESS_WANTED_OD09").default("PROPOSED_BLOCK_UNLESS_WANTED_OD09"),
    postReleaseRecollection: z.literal("PENDING_OD17_VOID_FIRST").default("PENDING_OD17_VOID_FIRST"), noticeChannel: z.literal("NIPT_ONLY_PENDING_OD07").default("NIPT_ONLY_PENDING_OD07"),
    releaseAuthority: z.literal("HOLD_AL5").default("HOLD_AL5") }).strict(),
    default: { picVersion: "unvalidated", maxUploadMb: 10, pdfSourcePath: "simulator/results", scanSubfolders: true, acceptZip: true, maxFilesPerScan: 500, scheduledScanMinutes: 0, gaToleranceDays: 7, linkageMode: "MANUAL_REVIEWED_ONLY", certificationMethod: "PENDING_OD05", sexDisclosureRule: "PROPOSED_BLOCK_UNLESS_WANTED_OD09", postReleaseRecollection: "PENDING_OD17_VOID_FIRST", noticeChannel: "NIPT_ONLY_PENDING_OD07", releaseAuthority: "HOLD_AL5" } },
  his_outbound: { category: "HIS Outbound/CFS", risk: "INTEGRATION", schema: z.object({ enabled: z.boolean(), target: z.enum(["SIMULATOR","AUTHORIZED_SHARE"]), productionAuthorized: z.boolean(), resultStyle: z.enum(["full", "short", "fixed"]), retryLimit: z.number().int().min(1).max(10), round2SpecimenDatePolicy: z.enum(['CURRENT_ROUND','ORIGINAL_ORDER']).nullable(), resDestinationPath: pathValue.default("simulator/p6/res"), pdfDestinationPath: pathValue.default("simulator/p6/cfs"), backupPath: pathValue.default("simulator/p6/backup"), secretRef: z.uuid().nullable().default(null), retryDelaySeconds: z.number().int().min(1).max(3600).default(5), confirmationTimeoutSeconds: z.number().int().min(1).max(86400).default(300),resProfile:operationalProfileSchema.nullable().default(null),certifierHisMappings:z.record(z.uuid(),z.string().max(240).refine(v=>/^[A-Za-z0-9_-]+\^[^|\\~&^\r\n\0]+$/.test(v),'INVALID_HIS_CERTIFIER')).default({}) }).strict(), default: { enabled: false, target: "SIMULATOR", productionAuthorized: false, resultStyle: "full", retryLimit: 5, round2SpecimenDatePolicy: null, resDestinationPath: "simulator/p6/res", pdfDestinationPath: "simulator/p6/cfs", backupPath: "simulator/p6/backup", secretRef: null, retryDelaySeconds: 5, confirmationTimeoutSeconds: 300,resProfile:null,certifierHisMappings:{} } },
  storage_backup: { category: "Storage/NAS/Backup", risk: "INTEGRATION", schema: z.object({ retentionDays: z.number().int().min(1).max(3650), target: z.literal("SIMULATOR") }).strict(), default: { retentionDays: 30, target: "SIMULATOR" } },
  notifications: { category: "Notifications/System/Audit", risk: "GENERAL", schema: z.object({ staleSeconds: z.number().int().min(60).max(3600), backlogWarning: z.number().int().min(1).max(10000) }).strict(), default: { staleSeconds: 90, backlogWarning: 10 } },
  // P5H: Owner decisions OD-18/OD-19 are open, so both choices default to PENDING and historical evaluation then fails closed.
  historical_backfill: { category: "Result Management", risk: "CLINICAL", schema: z.object({ anchorPolicy: z.enum(["PENDING_OD18", "A_FINAL_REPORT", "B_FINAL_REPORT_OR_CONTROL_RECORD"]), minimumProfile: z.enum(["PENDING_OD18", "OD18_A_IDENTITY_AND_ORIGINAL", "OD18_B_BALANCED"]), maxBatchRows: z.number().int().min(1).max(200) }).strict(), default: { anchorPolicy: "PENDING_OD18", minimumProfile: "PENDING_OD18", maxBatchRows: 100 } },
  // Task 3 (Owner 2026-10-25): approval of the versioned interpretation and of each product/master combination for internally
  // generated reports. Defaults approve nothing, so every internal report stays on HOLD until a CLINICAL maker-checker activation.
  report_interpretation: { category: "Result Management", risk: "CLINICAL", schema: z.object({ rulesetId: z.literal("CBH-READYGEN-REF"), rulesetVersion: z.literal("1.0.0"),
    rulesetSha256: z.literal(REPORT_RULESET_SHA256), interpretationApproved: z.boolean(), singletonApprovedProduct: z.enum(REPORT_PRODUCT_CHOICES), twinApprovedProduct: z.enum(REPORT_PRODUCT_CHOICES),
    noCallRenderingApproved: z.boolean(), approvalReference: z.string().max(300).refine(v => !/[\r\n\0]/.test(v), "REFERENCE_INVALID") }).strict(),
    default: { rulesetId: "CBH-READYGEN-REF", rulesetVersion: "1.0.0", rulesetSha256: REPORT_RULESET_SHA256, interpretationApproved: false, singletonApprovedProduct: "NONE", twinApprovedProduct: "NONE", noCallRenderingApproved: false, approvalReference: "" } },
  report_output: { category: "Result Management", risk: "GENERAL", schema: z.object({ downloadNameTemplate: z.string().min(5).max(160) }).strict(), default: { downloadNameTemplate: "{hisLn}_{patientName}_Chonburi hospital" } },
  go_live_cutoff: { category: "Result Management", risk: "CLINICAL", schema: z.object({ cutoff: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), impactReportHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(), default: null }
} as const;
export type SettingKey = keyof typeof SETTINGS;
export function settingDefinition(key: string) {
  if (!(key in SETTINGS)) throw new Error("UNKNOWN_OR_LOCKED_SETTING");
  return SETTINGS[key as SettingKey];
}
