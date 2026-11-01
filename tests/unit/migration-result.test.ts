import {it,expect} from 'vitest';
import {parseReport} from '../../packages/results/parser';
import {matchMigrationPdf} from '../../packages/migration/bulk-pdf';
import {migrationResultSummary} from '../../packages/migration/result-summary';
const row={recordId:'record',caseId:'case',roundId:'round',attemptId:'attempt2',ln:'123',lnHalos:'26B261014027',sampleRaw:'26B261014027-2',attemptNumber:2,hn:'000123',current:true,qualified:true};
it('matches content exact current attempt and HN once the file identity agrees',()=>{
 const p=parseReport('Lab No. (LN): 26B261014027-2 HN: 123'),file='9900000001 SYNTHETIC PATIENT.pdf',r={...row,ln:'9900000001',patientName:'SYNTHETIC PATIENT'};
 expect(matchMigrationPdf(p,[r],file).match?.attemptId).toBe('attempt2');
 expect(matchMigrationPdf(parseReport('Lab No. (LN): 26B261014027-1 HN: 123'),[r],file).match).toBeNull();
 expect(matchMigrationPdf(parseReport('Lab No. (LN): 26B261014027-2 HN: 999'),[r],file).match).toBeNull();
 expect(matchMigrationPdf(p,[r,{...r,recordId:'other'}],file).match).toBeNull();
});
it('does not expose HALOS to ANC or default unknown/No Call to Low Risk',()=>{
 expect(migrationResultSummary({audience:'ANC',released:false,halos:{t21:'Low Risk'}})).toBeNull();
 expect(migrationResultSummary({audience:'LAB',released:false,halos:{t21:null}})).toMatchObject({source:'HALOS',released:false,values:{t21:null}});
 const parsed=parseReport('Result = No Call\nTRISOMY 21 TRISOMY 18 TRISOMY 13 Fetal Gender');
 expect(migrationResultSummary({audience:'ANC',released:true,parsed})).toMatchObject({source:'OFFICIAL_PDF',values:{result:'No Call',t21:null}});
});
import {migrationPredicates} from '../../packages/migration/result-eligibility';
it('historical eligibility keeps current-source, identity, review, hold and certifier independent',()=>{
 const base={current:true,reviewed:true,identity:true,readable:true,linked:true,latest:true,hold:false,revoked:false,certifier:true,openProposal:false,versionOpen:true};
 expect(migrationPredicates(base,'CERTIFY_ATTEMPT').every(p=>p.status==='PASS')).toBe(true);
 for(const patch of [{current:false},{reviewed:false},{identity:false},{readable:false},{latest:false},{hold:true},{revoked:true},{certifier:false},{openProposal:true}]){
 expect(migrationPredicates({...base,...patch},'CERTIFY_ATTEMPT').some(p=>p.status==='FAIL')).toBe(true);
 }
});
it('keeps substantive PDF/HALOS discrepancies while ignoring fetal-fraction decimal formatting',()=>{
 const p=parseReport('TRISOMY 21 TRISOMY 18 TRISOMY 13 Fetal Gender\nLow Risk Low Risk Low Risk Female\nSEX CHROMOSOME ANEUPLOIDIES\nNot Detected Not Detected Not Detected Not Detected 12.4\nRESULTS QC: PASS');
 expect(p.results.fetalFraction.value).toBe(12.4);
 const s=migrationResultSummary({audience:'LAB',released:true,parsed:p,halos:{t21:'High Risk',fetalFraction:'12.40'}});
 expect(s).toMatchObject({source:'OFFICIAL_PDF',discrepancies:['t21']});
});
