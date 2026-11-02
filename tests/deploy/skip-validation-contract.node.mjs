import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const src=readFileSync(new URL('../../deploy/windows/deploy-production.ps1',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const staging=readFileSync(new URL('../../deploy/windows/deploy-staging.ps1',import.meta.url),'utf8');

test('-SkipValidationReason only skips the test run: dependencies and deploy contracts still run',()=>{
 const branch=/if \(\$SkipValidationReason\) \{([\s\S]*?)\n    \} elseif/.exec(src)?.[1];
 assert.ok(branch,'skip branch found');
 assert.match(branch,/Invoke-NiptValidation \$tc \$wt 'quick'/);
 assert.doesNotMatch(branch,/\b(exit|return)\b/);
});
test('the pre-package preflight runs on every path to New-NiptPackage in Production, after the skip decision, so no switch can bypass it',()=>{
 const calls=[...src.matchAll(/Invoke-NiptPreflight/g)].length;
 assert.equal(calls,2,'Staging-verified path and direct path');
 const direct=src.slice(src.indexOf('$detail.validation = $steps'));
 assert.ok(direct.indexOf('Invoke-NiptPreflight')>=0&&direct.indexOf('Invoke-NiptPreflight')<direct.indexOf('New-NiptPackage'),'preflight precedes the package on the direct path');
 const verified=src.slice(src.indexOf('Staging evidence for this exact commit'),src.indexOf('} else {\n    # LOW or MEDIUM'));
 assert.ok(verified.indexOf('Invoke-NiptPreflight')<verified.indexOf('New-NiptPackage'),'preflight precedes the package on the verified path');
 assert.match(staging,/Invoke-NiptPreflight[\s\S]*New-NiptPackage/);
});
test('a failed or blocked preflight stops the deployment before any package is built',()=>{
 const psm1=readFileSync(new URL('../../deploy/windows/NiptDeploy.psm1',import.meta.url),'utf8');
 assert.match(psm1,/if \(\$r\.ExitCode -ne 0\) \{[\s\S]*throw "PREFLIGHT_FAILED/);
 assert.match(psm1,/status -in 'FAIL', 'BLOCKED'/);
});
