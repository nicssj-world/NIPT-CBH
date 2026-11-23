import {it,expect} from 'vitest';
import {saveInput,isPdf,concordant,tabOf} from '../../packages/confirm/model';
import {tallyRows,ppvOf} from '../../packages/confirm/stats';
import type {ConfirmRow} from '../../packages/confirm/service';

const id='0d4a1c62-8e7b-4c1f-9a39-2f5d8b6c1e00';
it('input: strict fields, real calendar days, procedure before report, outcome codes only',()=>{
 expect(saveInput.parse({caseId:id,versionId:id,expectedSequence:null,status:'PENDING'})).toMatchObject({findings:{},method:null,note:''});
 expect(()=>saveInput.parse({caseId:id,versionId:id,expectedSequence:null,status:'PENDING',extra:1})).toThrow();
 expect(()=>saveInput.parse({caseId:id,versionId:id,expectedSequence:null,status:'RESULTED',reportDate:'2026-02-30'})).toThrow();
 expect(()=>saveInput.parse({caseId:id,versionId:id,expectedSequence:null,status:'RESULTED',procedureDate:'2026-11-10',reportDate:'2026-11-01'})).toThrow(/CONFIRM_DATE_ORDER/);
 expect(()=>saveInput.parse({caseId:id,versionId:id,expectedSequence:null,status:'RESULTED',findings:{t21:'MAYBE'}})).toThrow();
 expect(()=>saveInput.parse({caseId:id,versionId:id,expectedSequence:null,status:'RESULTED',findings:{t99:'TRUE_POSITIVE'}})).toThrow();
 expect(()=>saveInput.parse({caseId:id,versionId:id,expectedSequence:null,status:'PENDING',note:'a\u0000b'})).toThrow();
});
it('PDF magic bytes, concordance and tabs',()=>{
 expect(isPdf(Buffer.from('%PDF-1.7'))).toBe(true);
 expect(isPdf(Buffer.from('%PDX-1.7'))).toBe(false);
 expect(isPdf(Buffer.from('%PD'))).toBe(false);
 expect(concordant({t21:'TRUE_POSITIVE',xo:'MOSAIC_OTHER'},['t21','xo'])).toBe(false);
 expect(concordant({t21:'TRUE_POSITIVE'},['t21'])).toBe(true);
 expect(concordant({},[])).toBe(false);
 expect([tabOf('PENDING'),tabOf('POSTNATAL'),tabOf('LOST_FOLLOW_UP')]).toEqual(['PENDING','RESULTED','NOT_DONE']);
});
it('tally: a finding without an outcome is screened only; % is one decimal and null without a denominator',()=>{
 const row=(status:ConfirmRow['status'],screen:ConfirmRow['screen'],findings:Record<string,string>={}):ConfirmRow=>({caseId:id,versionId:id,ln:'1',lnHalos:null,hn:null,name:null,releasedAt:'',fiscalYear:2570,screen,status,concordant:null,waitingDays:null,
  record:status==='PENDING'?null:{sequence:1,status,method:null,specimen:null,outlabName:'',procedureDate:null,reportDate:null,resultText:'',hasReport:true,findings:findings as never,note:'',at:'',by:null}});
 const t=tallyRows([row('RESULTED',['t21'],{t21:'TRUE_POSITIVE'}),row('RESULTED',['t21'],{t21:'FALSE_POSITIVE'}),row('RESULTED',['t21'],{t21:'TRUE_POSITIVE'}),row('PENDING',['t18']),row('LOST_FOLLOW_UP',['other'])]);
 expect(t.byFinding.t21).toEqual({screened:3,confirmed:3,truePositive:2,falsePositive:1,mosaicOther:0,ppv:66.7});
 expect(t.overall).toMatchObject({screened:5,confirmed:3});
 expect(t.status).toMatchObject({RESULTED:3,PENDING:1,LOST_FOLLOW_UP:1});
 expect(ppvOf({confirmed:0,truePositive:0})).toBeNull();
});
it('finding keys follow the result positive keys, plus other',async()=>{
 const {POSITIVE_KEYS}=await import('../../packages/results/query');const {FINDING_KEYS}=await import('../../packages/confirm/model');
 expect(FINDING_KEYS).toEqual([...POSITIVE_KEYS,'other']);
});
