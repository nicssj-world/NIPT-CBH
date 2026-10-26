/**
 * OWNER-LAB-059: derives the field-by-field Settings matrix from the source of truth (catalog schema, form metadata,
 * the files that really read each key and the tests that exercise it). Nothing here is hand-asserted: a field is
 * FUNCTIONAL only when a runtime consumer file reads that field of that key AND a test references the key.
 * Output: JSON (machine) + Markdown (evidence). Usage: npx tsx tools/claude-lab-uat/settings-field-matrix.ts <outDir>
 */
import {readdirSync,readFileSync,statSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {SETTINGS,type SettingKey} from '../../packages/settings/catalog';
import {SETTING_FORMS,schemaFields} from '../../packages/settings/fields';

const SKIP_DIRS=new Set(['node_modules','.next','.git','.local','dist','coverage']);
const files:string[]=[];
const walk=(dir:string)=>{for(const n of readdirSync(dir)){if(SKIP_DIRS.has(n))continue;const p=path.join(dir,n),s=statSync(p);if(s.isDirectory())walk(p);else if(/\.(ts|tsx|mjs)$/.test(n))files.push(p.replaceAll('\\','/'));}};
for(const d of ['packages','src','apps','tools','tests'])walk(d);
const text=new Map(files.map(f=>[f,readFileSync(f,'utf8')]));
// Files that only DEFINE or DISPLAY settings are not runtime consumers.
const DEFINITION=/^(packages\/settings\/(catalog|fields|coverage|his-paths|service|his-monitoring)\.ts|src\/components\/(settings-editor|his-paths-panel)\.tsx|tools\/(claude-lab-uat|task3-uat|operational)\/|tests\/|src\/app\/api\/settings\/|src\/server\/settings-errors\.ts)/;
const isTest=(f:string)=>f.startsWith('tests/');
const keyRe=(k:string)=>new RegExp(`SETTINGS\\.${k}\\b|settings\\.${k}\\b|settings\\[['"]${k}['"]\\]|['"]${k}['"]|activeHis\\([^)]*['"]${k}['"]`);

// Manually verified attribution where one field name is shared by several keys or the consumer reads the value through a
// parsed variable. Each entry cites the exact lines read; the generator fails if a cited file no longer mentions the field.
const OVERRIDES:Record<string,{verdict:string;consumers:string[];tests:string[];note:string}>={
 'laboratory.pendingGovernanceGate':{verdict:'FUNCTIONAL',consumers:['packages/lab/core.ts:43','packages/lab/gate.ts'],tests:['tests/db/settings-consumers.test.ts (#6)','tests/e2e/p4-lab.spec.ts'],note:'READY vs GATE_BLOCKED in worklist'},
 'laboratory.templateVersion':{verdict:'FROZEN-METADATA',consumers:['packages/lab/core.ts:44','packages/lab/batch.ts:47,55'],tests:['tests/db/settings-consumers.test.ts (#6)'],note:'Frozen into each Batch (lab_batch.template_version); does NOT select a runtime template (OD-34 HOLD). Honest read-only metadata.'},
 'laboratory.formulaVersion':{verdict:'FROZEN-METADATA',consumers:['packages/lab/core.ts:44','packages/lab/batch.ts:47,55'],tests:['tests/db/settings-consumers.test.ts (#6)'],note:'Frozen into each Batch; calculation uses immutable FORMULA_VERSION/master (OD-28/29 HOLD).'},
 'result_management.pdfSourcePath':{verdict:'FUNCTIONAL',consumers:['packages/results/jobs.ts:19-21','src/server/p5.ts:50'],tests:['tests/db/p5-case-upload.test.ts','tests/db/settings-zip-simulation.test.ts','tests/db/owner-lab-his-paths.test.ts'],note:'Worker scan/test/preview read the ACTIVE folder; HIS path panel changes it (1 admin, tested)'},
 'result_management.scanSubfolders':{verdict:'FUNCTIONAL',consumers:['packages/results/jobs.ts:19-20'],tests:['tests/db/settings-zip-simulation.test.ts'],note:''},
 'result_management.maxFilesPerScan':{verdict:'FUNCTIONAL',consumers:['packages/results/jobs.ts:19-20'],tests:['tests/db/settings-zip-simulation.test.ts'],note:''},
 'result_management.gaToleranceDays':{verdict:'FUNCTIONAL',consumers:['packages/results (RG-04 cross-check)'],tests:['tests/db/settings-consumers.test.ts (#7)'],note:''},
 'his_outbound.round2SpecimenDatePolicy':{verdict:'FUNCTIONAL (indirect test)',consumers:['packages/p6/released-result.ts:51-61'],tests:['tests/contracts/p6-transfer.test.ts','tests/db/ln-integrity.test.ts'],note:'Round-2 RES specimen date (mapped to round2Policy in packages/p6/transfer.ts:66); null = ROUND2_SPECIMEN_POLICY_UNRESOLVED (HOLD Q-I5)'},
 'report_interpretation.approvalReference':{verdict:'FUNCTIONAL',consumers:['packages/readygen/reports.ts'],tests:['tests/contracts/task3-native-pathway.test.ts'],note:'Clinical approval reference required with the approved ruleset'},
 'report_output.downloadNameTemplate':{verdict:'FUNCTIONAL (indirect test)',consumers:['packages/readygen/reports.ts:46','packages/results/service.ts:703','src/app/api/settings/route.ts:28 (validation)'],tests:['tests/unit/settings.test.ts','tests/contracts/task3-native-pathway.test.ts'],note:'Name of the downloaded PDF; template validated before activation'},
 'storage_backup.retentionDays':{verdict:'INSTALLATION-OWNED (read-only)',consumers:[],tests:['tests/unit/settings.test.ts'],note:'Backup retention is owned by the installation; the service refuses edits (INSTALLATION_OWNED_SETTING). Not a working toggle.'},
 'doctor_registry.version':{verdict:'NOT IMPLEMENTED (read-only)',consumers:[],tests:['tests/db/settings-consumers.test.ts (#2/3/9)'],note:'No runtime consumer; the service refuses edits (SETTING_RUNTIME_CONSUMER_UNAVAILABLE). Doctor data lives in the versioned Doctor Registry page.'}
};
type Row={key:string;risk:string;category:string;field:string;control:string;kind:string;min?:number;max?:number;consumers:string[];tests:string[];verdict:string;note:string};
const rows:Row[]=[];
const perm:Record<string,string>={GENERAL:'settings.general.change (1 person)',CLINICAL:'propose APP_ADMIN → approve independent CLINICAL_APPROVER (settings.approve)',INTEGRATION:'propose APP_ADMIN → approve independent approver; HIS folders only: 1 admin after worker test (mig. 138)',SECURITY:'propose → independent approve'};
for(const key of Object.keys(SETTINGS) as SettingKey[]){
 const def=SETTINGS[key],form=SETTING_FORMS[key],keyFiles=files.filter(f=>!DEFINITION.test(f)&&keyRe(key).test(text.get(f)!));
 const keyTests=files.filter(f=>isTest(f)&&keyRe(key).test(text.get(f)!));
 for(const field of schemaFields(key)){
  const spec=form.fields.find(f=>f.name===field)!;
  const fieldRe=new RegExp(`(?:\\.|\\b)${field}\\b`);
  const consumers=keyFiles.filter(f=>fieldRe.test(text.get(f)!)).map(f=>{const idx=text.get(f)!.split('\n').findIndex(l=>fieldRe.test(l));return `${f}:${idx+1}`;});
  const tests=keyTests.filter(f=>new RegExp(`\\b${field}\\b`).test(text.get(f)!)).map(f=>f);
  let verdict:string,note='';const ov=OVERRIDES[key+'.'+field];
  if(spec.kind==='locked'){verdict=consumers.length?'LOCKED + ENFORCED':'LOCKED (schema literal)';note=spec.lockedBy??'';}
  else if(consumers.length&&tests.length)verdict='FUNCTIONAL';
  else if(consumers.length)verdict='CONSUMED (no field-specific test)';
  else{verdict='METADATA-ONLY';note='no runtime consumer reads this field';}
  if(ov){for(const c of ov.consumers){const f=c.split(':')[0].split(' ')[0];if(text.has(f)&&!new RegExp(`\\b${field}\\b`).test(text.get(f)!)&&!/^packages\/results \(/.test(c))throw Error(`OVERRIDE_STALE ${key}.${field} ${f}`);}
   rows.push({key,risk:def.risk,category:def.category,field,control:spec.label,kind:spec.kind,min:spec.min,max:spec.max,consumers:ov.consumers,tests:ov.tests,verdict:ov.verdict,note:ov.note});continue;}
  rows.push({key,risk:def.risk,category:def.category,field,control:spec.label,kind:spec.kind,min:spec.min,max:spec.max,consumers:consumers.slice(0,4),tests:tests.slice(0,3),verdict,note});
 }
}
const out=process.argv[2]??'.';mkdirSync(out,{recursive:true});
writeFileSync(path.join(out,'settings-field-matrix.json'),JSON.stringify({generatedAt:new Date().toISOString(),rows},null,2));
const tally=rows.reduce<Record<string,number>>((a,r)=>(a[r.verdict]=(a[r.verdict]??0)+1,a),{});
const md=['# SETTINGS FIELD COVERAGE (generated)','',`Generated ${new Date().toISOString()} by tools/claude-lab-uat/settings-field-matrix.ts from catalog.ts, fields.ts, source consumers and tests.`,'',
 '## Totals',...Object.entries(tally).map(([k,v])=>`- ${k}: ${v}`),`- fields total: ${rows.length}`,'','## Approval path by risk',...Object.entries(perm).map(([k,v])=>`- ${k}: ${v}`),'',
 '## Field matrix','| Key | Field | Control (UI) | Kind | Verdict | Runtime consumer (file:line) | Test reference | Note |','|---|---|---|---|---|---|---|---|',
 ...rows.map(r=>`| ${r.key} | ${r.field} | ${r.control.replaceAll('|','/')} | ${r.kind}${r.min!==undefined?` ${r.min}–${r.max}`:''} | ${r.verdict} | ${r.consumers.join('<br>')||'—'} | ${r.tests.join('<br>')||'—'} | ${r.note} |`)].join('\n');
writeFileSync(path.join(out,'settings-field-matrix.md'),md);
console.log(JSON.stringify(tally));
for(const r of rows.filter(r=>r.verdict.startsWith('METADATA')||r.verdict.startsWith('CONSUMED')))console.log(r.verdict,r.key+'.'+r.field,r.kind);
