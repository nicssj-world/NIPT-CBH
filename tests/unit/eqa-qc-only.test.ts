import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
const read=(p:string)=>readFileSync(p,'utf8');
it('EQA is worked in Quality Control only: the results list and the report worklist leave EQA out, Quality Control embeds the EQA worklist, the page has no consent',()=>{
 expect(read('packages/results/query.ts')).toContain('NOT EXISTS(SELECT 1 FROM eqa_case eqa WHERE eqa.case_id=c.id)');   // /results list
 expect(read('packages/readygen/reports.ts')).toContain("r.is_eqa===(d.scope==='EQA')");                                 // report worklist: patients on /results, EQA in QC
 expect(read('src/components/p5/native-reports.tsx')).toContain('scope==="PATIENT"&&<details');                         // the HALOS import stays on /results
 expect(read('src/app/(protected)/quality-control/page.tsx')).toContain('<NativeReports canImport={false} scope="EQA"/>');
 const view=read('src/components/quality-control/eqa-case-view.tsx');
 expect(view).not.toMatch(/ใบยินยอม.*เริ่มลงนาม|consent\.prepare|startSigning/);                                         // no consent signing on an EQA page
 expect(view).toContain('/api/eqa/update');
 expect(read('src/components/p2/case-workspace.tsx')).toContain('if(data.eqa)return <EqaCaseView');
});
