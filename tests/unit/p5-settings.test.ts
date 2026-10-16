import {readFile} from 'node:fs/promises';
import {describe,it,expect} from 'vitest';
import {SETTINGS,type SettingKey} from '../../packages/settings/catalog';
import {SETTING_FORMS,schemaFields} from '../../packages/settings/fields';
import {SETTINGS_COVERAGE,COVERAGE_CATEGORIES,coverageSummary} from '../../packages/settings/coverage';
import {renderCoverageMarkdown} from '../../tools/settings-coverage';

describe('Settings forms and coverage (Plan §13.2, P5 delivery)',()=>{
 it('every catalog field has exactly one labelled form field; locked fields are schema literals',()=>{
  for(const key of Object.keys(SETTINGS) as SettingKey[]){
   const form=SETTING_FORMS[key];expect(form.key).toBe(key);
   expect(form.fields.map(f=>f.name).sort()).toEqual(schemaFields(key).sort());
   for(const f of form.fields){expect(f.label.length).toBeGreaterThan(1);expect(f.help.length).toBeGreaterThan(1);
    if(f.kind==='locked'){const def=SETTINGS[key].default as Record<string,unknown>|null;expect(()=>SETTINGS[key].schema.parse({...def,[f.name]:'CHANGED'})).toThrow();}}
  }
 });
 it('all ten §13.2 categories are covered and every catalog key appears in the matrix',()=>{
  expect(COVERAGE_CATEGORIES).toHaveLength(10);expect(SETTINGS_COVERAGE).toHaveLength(102);
  for(let n=1;n<=10;n++)expect(SETTINGS_COVERAGE.filter(x=>x.category===n).length).toBeGreaterThan(0);
  const sources=SETTINGS_COVERAGE.map(x=>x.source??'').join(' ');
  for(const key of Object.keys(SETTINGS))expect(sources).toContain(key);
  expect(SETTINGS_COVERAGE.find(x=>x.item.startsWith('go_live_cutoff'))?.status).toBe('Implemented');
  expect(coverageSummary().reduce((s,c)=>s+Object.values(c.counts).reduce((a,b)=>a+b,0),0)).toBe(SETTINGS_COVERAGE.length);
 });
 it('every NIPTY settings key (identical in NIPTY.zip and NIPTY_handover.zip) is mapped',()=>{
  const nipty=['path_workload','path_pdfresult','path_pdfrename','path_resoutput','nipt_testcode','nipt_result_text','nipt_result_style','pdf_template','hospital_suffix','hl7_sender','hl7_receiver','alert_days','hl7_specimen_code','hl7_o_field18','hl7_accession_sfx','hl7_operator_id','hl7_ward_id','hl7_ward_name','auto_scan_min','server_host','server_port','path_request','pet_autoimport_enabled','pet_scan_interval_min','pet_scan_days_back'];
  const mapped=SETTINGS_COVERAGE.map(x=>x.nipty??'').join(' ');for(const k of nipty)expect(mapped,k).toContain(k);
 });
 it('P1 result_management revisions remain valid; hold fields cannot be opened',()=>{
  const old=SETTINGS.result_management.schema.parse({picVersion:'unvalidated',maxUploadMb:10});expect(old.releaseAuthority).toBe('HOLD_AL5');expect(old.pdfSourcePath).toBe('simulator/results');
  expect(()=>SETTINGS.result_management.schema.parse({...SETTINGS.result_management.default,linkageMode:'AUTO_PIC'})).toThrow();
 });
 it('A23 scheduled scan: 0 = off by default, otherwise 5–1440 minutes, maker-checker (CLINICAL) category',()=>{
  expect(SETTINGS.result_management.default.scheduledScanMinutes).toBe(0);expect(SETTINGS.result_management.risk).toBe('CLINICAL');
  expect(SETTINGS.result_management.schema.parse({picVersion:'unvalidated',maxUploadMb:10}).scheduledScanMinutes).toBe(0);
  for(const ok of [0,5,60,1440])expect(SETTINGS.result_management.schema.parse({...SETTINGS.result_management.default,scheduledScanMinutes:ok}).scheduledScanMinutes).toBe(ok);
  for(const bad of [1,4,1441,2.5,-5])expect(()=>SETTINGS.result_management.schema.parse({...SETTINGS.result_management.default,scheduledScanMinutes:bad})).toThrow();
 });
 it('docs/p5-settings-coverage.md is generated from the matrix',async()=>{expect((await readFile('docs/p5-settings-coverage.md','utf8')).replace(/\r\n/g,'\n')).toBe(renderCoverageMarkdown());});
});
