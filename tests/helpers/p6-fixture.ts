import {syntheticProfile} from '../../packages/p6/res';
import type {SyntheticDraft} from '../../packages/p6/transfer';

export function fixture(index=1):SyntheticDraft {
  return {fixtureId:`SYNTHETIC-TRANSFER-${index}`,reportVersionId:`SYNTHETIC-VERSION-${index}`,roundId:`SYNTHETIC-ROUND-${index}`,attemptId:`SYNTHETIC-ATTEMPT-${index}`,origin:'ANC',lnGeneration:1,roundNumber:1,epoch:0,
    input:{order:{ln:`99000${String(index).padStart(7,'0')}`,hn:`SYNTHETIC-HN-${index}`,dspname:'นาง SYNTHETIC  SYNTHETIC',dob:'20000101',sex:'F',specimen_date:'20261010070000'},result:null,generatedAt:'20261011123456',approvedAt:'20261011110000',certifierHisId:'SYNTHETIC^SYNTHETIC'},
    profile:{...syntheticProfile},pdf:Buffer.from('%PDF-1.4\nSYNTHETIC P6 ONLY\n%%EOF'),settings:{version:'SYNTHETIC-CONFIG-1',resDirectory:'simulator/p6/res',pdfDirectory:'simulator/p6/cfs',backupDirectory:'simulator/p6/backup',retryDelaysMs:[1000,2000],confirmationTimeoutMs:1000}};
}
