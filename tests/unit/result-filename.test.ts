import {expect,it} from 'vitest';
import {DEFAULT_DOWNLOAD_TEMPLATE,renderDownloadName,reportRunToken,templateProblems} from '../../packages/readygen/filename';
import {SETTINGS} from '../../packages/settings/catalog';
import {frozenOutboundAuthority} from '../../packages/settings/his';
import {freezeSyntheticTransfer} from '../../packages/p6/transfer';
import {fixture as draft} from '../helpers/p6-fixture';

it('uses the source run with a minimum two-digit number and Buddhist year, retaining identifier zeros',()=>{
 expect(reportRunToken(4,2026)).toBe('run042569');
 expect(reportRunToken(104,2026)).toBe('run1042569');
 expect(()=>reportRunToken(0,2026)).toThrow('REPORT_RUN_INVALID');
 expect(templateProblems('{run}_{hn}_{hisLn}')).toEqual([]);
 expect(renderDownloadName(DEFAULT_DOWNLOAD_TEMPLATE,{run:reportRunToken(4,2026),hisLn:'000123',hn:'0012',lnHalos:'',sampleId:'',patientName:'',reportDate:'',template:'',version:'1'})).toBe('run042569_0012_000123.pdf');
 expect(()=>renderDownloadName(DEFAULT_DOWNLOAD_TEMPLATE,{hisLn:'000123',hn:'0012',lnHalos:'',sampleId:'',patientName:'',reportDate:'',template:'',version:'1'})).toThrow('REPORT_RUN_REQUIRED');
});
it('accepts a fixed operator while older saved profiles keep their certifier mappings',()=>{
 const old=SETTINGS.his_outbound.schema.parse(SETTINGS.his_outbound.default);
 expect(old.operatorHisId).toBeNull();
 expect(SETTINGS.his_outbound.schema.parse({...old,operatorHisId:'OP01^Operator'}).operatorHisId).toBe('OP01^Operator');
 expect(SETTINGS.his_outbound.schema.safeParse({...old,operatorHisId:'OP01^Bad|name'}).success).toBe(false);
});
it('freezes a shared PDF name while retaining the exact legacy RES/OK names and payload',()=>{
 const d=draft(),old=freezeSyntheticTransfer(d,1),p=freezeSyntheticTransfer({...d,pdfName:'run042569_SYNTHETIC-HN-1_990000000001.pdf'},1);
 expect(p.pdfName).toBe('run042569_SYNTHETIC-HN-1_990000000001.pdf');
 expect(p.resName).toBe(old.resName);expect(p.okName).toBe(old.okName);expect(p.resHex).toBe(old.resHex);
 expect(()=>freezeSyntheticTransfer({...d,pdfName:'../bad.pdf'},1)).toThrow();
 expect(()=>freezeSyntheticTransfer({...d,pdfName:'CON.pdf'},1)).toThrow();
});
it('keeps frozen content on profile/retry edits but detects rerouting and revocation',()=>{
 const active={id:'00000000-0000-4000-8000-000000000001',version:2,setting_key:'his_outbound' as const,value:{...SETTINGS.his_outbound.default,enabled:true,resultStyle:'short',retryLimit:2}};
 const frozen={...draft().settings,version:'SYNTHETIC-SETTINGS-previous'};
 expect(frozenOutboundAuthority(active,frozen,false)).toBe('CURRENT');
 expect(frozenOutboundAuthority({...active,value:{...active.value,pdfDestinationPath:'simulator/p6/other'}},frozen,false)).toBe('CONFIG_CHANGED');
 expect(frozenOutboundAuthority({...active,value:{...active.value,enabled:false}},frozen,false)).toBe('AUTHORITY_REVOKED');
 expect(frozenOutboundAuthority(active,frozen,true)).toBe('AUTHORITY_REVOKED');
});
