import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {SETTINGS_COVERAGE,COVERAGE_CATEGORIES,COVERAGE_STATUSES,coverageSummary} from '../packages/settings/coverage';

// Generates docs/p5-settings-coverage.md from packages/settings/coverage.ts (`npx tsx tools/settings-coverage.ts`).
const cell=(x:string|null)=>(x??'—').replace(/\|/g,'\\|');
export function renderCoverageMarkdown(){
 const out=['# Settings Coverage Matrix (Admin source re-audit)','','Generated from `packages/settings/coverage.ts`; the unit test `tests/unit/p5-settings.test.ts` fails if this file drifts.',
  'Sources: Plan v6.2.1 §13.1–§13.2 (SHA-256 `261acf8c…3c2e`), NIPTY settings seed (`app/database.py`, identical 25 keys in NIPTY.zip v1.4.3 and NIPTY_handover.zip), current NIPT CBH source.','',
  'Status: **Implemented** configurable/enforced and consumed now · **Partial** stored or simulator-only · **Missing** due by its phase but absent · **Deferred** later phase (P5H/P6/P7) · **HOLD** waits for an Owner/IT decision.','',
  'Installation-owned = operator/deployment responsibility; Locked = intentional fixed contract. See `docs/admin-settings-audit.md` for the nine evidence dimensions for every row.','',
  '## Summary','',`| # | หมวด | ${COVERAGE_STATUSES.join(' | ')} |`,`| ---: | --- | ${COVERAGE_STATUSES.map(()=>'---:').join(' | ')} |`,
  ...coverageSummary().map(c=>`| ${c.no} | ${c.name} | ${COVERAGE_STATUSES.map(s=>c.counts[s]).join(' | ')} |`),''];
 COVERAGE_CATEGORIES.forEach((name,n)=>{
  out.push(`## ${n+1}. ${name}`,'','| รายการ | Plan | NIPTY | NIPT CBH | สถานะ | Phase | หมายเหตุ |','| --- | --- | --- | --- | --- | --- | --- |');
  for(const x of SETTINGS_COVERAGE.filter(i=>i.category===n+1))out.push(`| ${cell(x.item)} | ${cell(x.plan)} | ${cell(x.nipty)} | ${cell(x.source)} | ${x.status} | ${x.phase} | ${cell(x.note||null)} |`);
  out.push('');
 });
 return out.join('\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await writeFile('docs/p5-settings-coverage.md',renderCoverageMarkdown());
