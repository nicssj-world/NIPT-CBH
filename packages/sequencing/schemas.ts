import {z} from 'zod';
import {uuid,reasonText} from '../lab/core';
import {numeric} from '../pooling/calculation';

import {QC3_CRITERIA,QC4_CRITERIA} from './constants';
export {HOLDS,QC3_CRITERIA,QC4_CRITERIA} from './constants';
// Identity comparison must preserve exact scanned/imported text; never trim a mismatch into a match.
export const opaque=z.string().min(1).max(160).refine(v=>v.trim().length>0&&!/[\u0000-\u001f\u007f]/.test(v),'INVALID_TEXT');
export const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const date=z.iso.date();
export const common=z.strictObject({batchId:uuid,dnbId:uuid,expectedVersion:z.number().int().nonnegative()});
export const command=common.extend({requestId:uuid});
export const lot=z.strictObject({name:opaque,lot:opaque,expiry:date});
export const preparationSchema=z.strictObject({
 method:z.literal('UNRESOLVED_OD32_WC05'),operatorId:uuid,equipmentId:opaque,
 lots:z.array(lot).min(1).max(20),qubitSamples:z.number().int().min(1).max(48),
 preclean:z.boolean(),loadingReagentPrepared:z.boolean(),
 protocolEvidence:z.strictObject({reference:opaque,sha256:hash}).optional()
});
export const createSchema=z.strictObject({batchId:uuid,poolSnapshotId:uuid,expectedVersion:z.number().int().nonnegative(),requestId:uuid,
 purpose:z.enum(['SYNTHETIC_SIMULATION','OPERATIONAL']),actualDate:date,preparation:preparationSchema,reason:reasonText});
export const transitionSchema=command.extend({transition:z.enum(['DNB_START','DNB_END','HOLD','STOP_USE']),reason:reasonText});
export const observationSchema=command.extend({field:z.enum(['STD1','STD2','QC3']),value:numeric,unit:z.literal('ng/uL'),
 source:z.enum(['DIRECT_ENTRY','PAPER_TRANSCRIPTION']),copyId:uuid.optional(),eventTime:z.iso.datetime({offset:true}).nullable().optional(),
 eventPrecision:z.enum(['MINUTE','DAY','NOT_RECORDED']).optional(),supersedesId:uuid.optional(),reason:reasonText.optional(),
 paperOperator:opaque.optional(),paperEvidenceHash:hash.optional()});
export const reviewSchema=command.extend({observationId:uuid,result:z.enum(['Confirmed','Discrepancy']),note:reasonText});
export const qc3Schema=command.extend({decision:z.enum(['Hold','Remeasure','Failed','SyntheticReviewed']),criteriaVersion:z.literal(QC3_CRITERIA),reason:reasonText});
export const fixtureMember=z.strictObject({memberKey:opaque,physicalPosition:z.number().int().min(1).max(48),role:z.enum(['PATIENT','PC','NC']),
 exportSampleId:opaque,printedSampleId:opaque,lnHalos:opaque,barcodeIndex:z.number().int().min(1).max(48),barcodeType:opaque});
export const handoffSchema=command.extend({mapping:z.strictObject({status:z.literal('synthetic-fixture-unverified'),evidenceReference:opaque,
 members:z.array(fixtureMember).length(47)}).optional(),reason:reasonText});
export const transferSchema=command.extend({handoffId:uuid,fileHash:hash,status:z.enum(['Complete','Incomplete','Failed']),
 evidenceHash:hash,evidenceReference:opaque,purpose:z.literal('SYNTHETIC_SIMULATION')});
export const verifySchema=command.extend({handoffId:uuid,transferId:uuid,observedRows:z.array(fixtureMember).max(48),
 observedDnbId:opaque,lane:z.literal('L01'),fileHash:hash,status:z.enum(['Complete','Incomplete','Failed']),evidenceHash:hash,note:reasonText});
export const sequencingSchema=command.extend({purpose:z.literal('SYNTHETIC_SIMULATION'),equipmentModel:z.literal('DNBSEQ-G50'),equipmentId:opaque,
 sequencingId:opaque,cartridgeId:opaque,flowCellId:opaque,idSource:z.enum(['SCAN','MANUAL_SYNTHETIC']),barcodeType:opaque,
 barcodeRange:z.strictObject({from:z.number().int().min(1).max(128),to:z.number().int().min(1).max(128)}).refine(x=>x.from<=x.to),
 recipe:opaque,configuration:z.strictObject({readMode:z.enum(['SE','PE']),readCycles:z.number().int().positive().max(500),barcodeCycles:z.number().int().positive().max(100),assay:opaque}),
 pressureKpa:z.string().regex(/^-?\d{1,6}(\.\d{1,8})?$/),diskSpaceGb:numeric,
 wash:z.strictObject({lot:opaque,preparedOn:date,expiry:date,preWash:z.literal(true)}),reason:reasonText});
export const sequenceTransitionSchema=command.extend({sequencingId:uuid,transition:z.enum(['SEQUENCE_START','SEQUENCE_END','ANALYSIS_COMPLETE']),reason:reasonText,
 firstCycle:z.strictObject({loadedDnb:numeric,q30:numeric,bic:numeric,fit:numeric}).optional(),postWash:z.literal(true).optional()});
export const qc4Schema=command.extend({sequencingId:uuid,scope:z.enum(['LANE','SAMPLE']),memberKey:opaque.optional(),lane:z.literal('L01'),
 metrics:z.strictObject({totalReads:numeric,uniqueReads:numeric,q30:numeric,gcPercent:numeric,fetalFraction:numeric.optional(),dim:numeric.optional()}),
 source:z.enum(['DIRECT_ENTRY','PAPER_TRANSCRIPTION']),copyId:uuid.optional(),eventTime:z.iso.datetime({offset:true}).nullable().optional(),
 eventPrecision:z.enum(['MINUTE','DAY','NOT_RECORDED']).optional(),evidenceHash:hash,supersedesId:uuid.optional(),reason:reasonText.optional()});
export const qc4ReviewSchema=command.extend({qc4Id:uuid,result:z.enum(['SyntheticReviewed','Hold','Failed']),criteriaVersion:z.literal(QC4_CRITERIA),note:reasonText});
export type Preparation=z.infer<typeof preparationSchema>;
export type FixtureMember=z.infer<typeof fixtureMember>;
