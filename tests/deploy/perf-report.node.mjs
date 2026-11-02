import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {analyseRun,summarise} from '../../tools/release/perf-report.mjs';

test('stage durations come from the timestamps of the run log, and a failed run names the step it died in',()=>{
 const d=mkdtempSync(path.join(tmpdir(),'perf-'));
 try{
  writeFileSync(path.join(d,'run.log'),[
   '2026-11-02T10:00:00.000+07:00 [INFO] start','2026-11-02T10:00:05.000+07:00 [STEP] validation: npm ci','2026-11-02T10:01:05.000+07:00 [STEP] validation: typecheck',
   '2026-11-02T10:01:35.000+07:00 [STEP] package: test 1.0.0 (app only)','2026-11-02T10:09:35.000+07:00 [FAIL] deploy FAILED'].join('\n'));
  writeFileSync(path.join(d,'record.json'),JSON.stringify({runId:'r',environment:'staging',action:'deploy',outcome:'FAILED',startedAt:'2026-11-02T10:00:00+07:00',finishedAt:'2026-11-02T10:09:35+07:00',error:'PACKAGE_BUILD_FAILED'}));
  const r=analyseRun(d);
  assert.equal(r.totalSeconds,575);
  assert.equal(r.stages['dependency installation (npm ci)'],60);
  assert.equal(r.stages['package (build + stage + hash + sign)'],480);
  assert.match(r.failedAfterStep,/^package:/);
  const s=summarise([r]);
  assert.equal(s.failed,1);assert.equal(s.secondsSpentOnFailedRuns,575);
 }finally{rmSync(d,{recursive:true,force:true});}
});
