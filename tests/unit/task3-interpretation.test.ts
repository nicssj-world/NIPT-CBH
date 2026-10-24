import {describe,it,expect} from 'vitest';
import {interpretRow,productCodeOf,halosGaDays,RULESET_SHA256,RULESET} from '../../packages/readygen/interpretation';
import {REPORT_RULESET_SHA256,SETTINGS} from '../../packages/settings/catalog';
import {templateProblems,renderDownloadName,uniqueNames} from '../../packages/readygen/filename';

const base={sampleQc:'Pass',operationAdvice:'Qualified',physicianAdvice:'Qualified',testChr13:'Negative',testChr18:'Negative',testChr21:'Negative',testSex:'Negative',fetalFraction:'14.7',risk13:'1/39594481',risk18:'1/2143998259',risk21:'1/2143998259',gender:'Female',testOther:'',disease:'',testCnv:''};
const run=(v:Partial<typeof base>,t:'SINGLETON'|'TWIN'='SINGLETON')=>interpretRow({values:{...base,...v}},t);
const codes=(v:Partial<typeof base>,t:'SINGLETON'|'TWIN'='SINGLETON')=>run(v,t).holds.map(h=>h.code);

describe('Task 3 interpretation (ReadyGen reference, fail-closed)',()=>{
 it('maps the reference tokens exactly and prints dynamic QC, probabilities and FF to 2 decimals',()=>{
  const r=run({});expect(r.status).toBe('FINAL_ELIGIBLE');
  expect(r.values).toMatchObject({qc:'PASS',t21:'Low Risk',t18:'Low Risk',t13:'Low Risk',xo:'Not Detected',xxx:'Not Detected',xxy:'Not Detected',xyy:'Not Detected',fetalGender:'Female',fetalFraction:'14.70'});
  expect(r.values.probability.t21).toBe('1/2143998259');expect(r.abnormal).toBe(false);
  for(const [t,v] of [['TH21','High Risk'],['TL21','High Risk']])expect(run({testChr21:t}).values.t21).toBe(v);
  expect(run({testChr21:'TH21'}).abnormal).toBe(true);
  expect(run({testSex:'XO(+++)'}).values).toMatchObject({xo:'Detected',xxx:'Not Detected'});expect(run({testSex:'XXY(+)'}).values.xxy).toBe('Detected');
  expect(run({gender:'Male'},'TWIN').values.yChromosome).toBe('Detected');expect(run({gender:'Female'},'TWIN').values.yChromosome).toBe('Not Detected');
 });
 it('ML21 with Pass + Rerun (the Owner fixture) is HOLD on two independent reasons, never Low Risk',()=>{
  const r=run({testChr21:'ML21',operationAdvice:'Rerun',physicianAdvice:'Rerun'});
  expect(r.status).toBe('HOLD');expect(r.holds.map(h=>h.code)).toEqual(expect.arrayContaining(['QC_RERUN_ADVISED','T21_TOKEN_UNRECOGNIZED']));expect(r.values.t21).toBeNull();expect(r.values.qc).toBeNull();
 });
 it('known ReadyGen reference defects are gated, not reproduced: T22 wording, T10 "101", malformed XO clause, unknown codes, missing ELSE',()=>{
  expect(codes({testOther:'T22'})).toContain('TESTOTHER_FINDING_REQUIRES_REVIEW');
  expect(codes({testOther:'T10'})).toContain('TESTOTHER_FINDING_REQUIRES_REVIEW');expect(codes({testOther:'101'})).toContain('TESTOTHER_FINDING_REQUIRES_REVIEW');
  for(const bad of ['XXYNot Detected','XO','XO(++)','XO(+++),XXX(+)','Monosomy X','T21'])expect(codes({testSex:bad})).toContain('SCA_TOKEN_UNRECOGNIZED');
  for(const bad of ['','ML21','Positive','negative','TH18'])expect(codes({testChr21:bad}).some(c=>/^T21_(MISSING|TOKEN_UNRECOGNIZED)$/.test(c))).toBe(true);
  expect(codes({disease:'Chromosome 9p deletion syndrome'})).toContain('DISEASE_FINDING_REQUIRES_REVIEW');expect(codes({testCnv:'del(1)(p36)'})).toContain('TESTCNV_FINDING_REQUIRES_REVIEW');
  expect(RULESET.knownReferenceDefects.length).toBeGreaterThanOrEqual(5);
 });
 it('QC fail, invalid FF, FF below the template reference, bad risk index and unknown gender are HOLD',()=>{
  expect(codes({sampleQc:'Fail'})).toContain('QC_NOT_PASS');expect(codes({sampleQc:'',operationAdvice:''})).toContain('QC_STATUS_UNRECOGNIZED');
  expect(codes({fetalFraction:'abc'})).toContain('FETAL_FRACTION_INVALID');expect(codes({fetalFraction:'3.2'})).toContain('FETAL_FRACTION_BELOW_TEMPLATE_REFERENCE');
  expect(codes({risk21:'≥1/100'})).toContain('T21_RISK_INDEX_INVALID');expect(codes({gender:'Unknown'})).toContain('GENDER_TOKEN_UNRECOGNIZED');expect(codes({gender:''})).toContain('GENDER_MISSING');
  // The twin master has no SCA section: an SCA call is reviewed, never dropped.
  expect(codes({testSex:'XO(+++)'},'TWIN')).toContain('TWIN_SCA_FINDING_HAS_NO_TEMPLATE_SECTION');
 });
 it('is deterministic and versioned; the catalog literal equals the engine hash',()=>{
  expect(run({})).toEqual(run({}));expect(run({}).ruleset).toEqual({id:'CBH-READYGEN-REF',version:'1.0.0',sha256:RULESET_SHA256});
  expect(REPORT_RULESET_SHA256).toBe(RULESET_SHA256);
  expect(SETTINGS.report_interpretation.default).toMatchObject({interpretationApproved:false,singletonApprovedProduct:'NONE',twinApprovedProduct:'NONE',noCallRenderingApproved:false});
 });
 it('product codes and HALOS GA',()=>{
  expect(productCodeOf('NIFTY(Y%)')).toBe('HNZ0011');expect(productCodeOf('NIFTY(SCA, MS3, IF, Y%)')).toBe('HNZ0051');expect(productCodeOf('NIFTY (Y%)')).toBe('HNZ0011');expect(productCodeOf('Unknown')).toBeNull();
  expect(halosGaDays('17,3')).toBe(122);expect(halosGaDays('17W3D')).toBeNull();
 });
});
describe('Task 3 download name template',()=>{
 const values={hisLn:'2628770022',lnHalos:'26B261014046',sampleId:'26B261014046-1',hn:'99000001',patientName:'น.ส.สมมุติ ทดสอบ',reportDate:'2026-10-25',template:'FM-WI-T-BM-17-07',version:'1'};
 it('validates placeholders, requires an identifier and renders Windows-safe names',()=>{
  expect(templateProblems('{hisLn}_{patientName}_Chonburi hospital')).toEqual([]);
  expect(templateProblems('{patientName}')).toContain('IDENTIFIER_REQUIRED');expect(templateProblems('{hisLn}_{unknown}')).toContain('UNKNOWN_PLACEHOLDER_UNKNOWN');expect(templateProblems('{hisLn}<x>')).toContain('FORBIDDEN_CHARACTER');
  expect(renderDownloadName('{hisLn}_{patientName}_Chonburi hospital',values)).toBe('2628770022_น.ส.สมมุติ ทดสอบ_Chonburi hospital.pdf');
  expect(renderDownloadName('{hisLn}_{patientName}',{...values,patientName:'a/b:c*?"<>|'})).toBe('2628770022_a_b_c______.pdf');
  expect(renderDownloadName('{sampleId}. ',values)).toBe('26B261014046-1.pdf');
  expect(()=>renderDownloadName('{patientName}',values)).toThrow('DOWNLOAD_NAME_TEMPLATE_INVALID');
 });
 it('resolves collisions inside one download without changing the first name',()=>{
  expect(uniqueNames(['a.pdf','A.pdf','b.pdf','a.pdf'])).toEqual(['a.pdf','A (2).pdf','b.pdf','a (3).pdf']);
 });
});
