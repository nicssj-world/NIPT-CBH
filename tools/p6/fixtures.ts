/** Test-tool-only deterministic fixture factory. Never imports a P5 asset/report/release. */
import {syntheticProfile} from '../../packages/p6/res';
import type {SyntheticDraft} from '../../packages/p6/transfer';
export function sandboxFixture(index:number):SyntheticDraft {
  if(!Number.isSafeInteger(index)||index<1||index>9999999)throw Error('INVALID_SYNTHETIC_FIXTURE_INDEX');
  return {fixtureId:`SYNTHETIC-P6-${index}`,reportVersionId:`SYNTHETIC-P6-VERSION-${index}`,roundId:`SYNTHETIC-P6-ROUND-${index}`,attemptId:`SYNTHETIC-P6-ATTEMPT-${index}`,origin:'ANC',lnGeneration:1,roundNumber:1,epoch:0,
    input:{order:{ln:'99000'+String(index).padStart(7,'0'),hn:`SYNTHETIC-HN-${index}`,dspname:'นาง SYNTHETIC  SYNTHETIC',dob:'20000101',sex:'F',specimen_date:'20261010070000'},result:null,generatedAt:'20261011123456',approvedAt:'20261011110000',certifierHisId:'SYNTHETIC^SYNTHETIC'},
    profile:{...syntheticProfile},pdf:Buffer.from('%PDF-1.4\n% SYNTHETIC P6 TRANSPORT FIXTURE ONLY\n%%EOF\n'),
    settings:{version:'SYNTHETIC-P6-CONFIG-1',resDirectory:'simulator/p6/res',pdfDirectory:'simulator/p6/cfs',backupDirectory:'simulator/p6/backup',retryDelaysMs:[1000,2000],confirmationTimeoutMs:60000}};
}
