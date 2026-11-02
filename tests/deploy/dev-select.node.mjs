import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectChecks,directTests} from '../../tools/dev/select.mjs';

const tests=['tests/unit/p2-pdf.test.ts','tests/unit/pdf.test.ts','tests/db/anc-owner-registry.test.ts','tests/db/migrations.test.ts','tests/db/p2-service.test.ts','tests/unit/storage-worker.test.ts','tests/deploy/x.node.mjs'];
test('a service change selects typecheck, lint and the focused area suites, not the whole suite',()=>{
 const p=selectChecks(['packages/p2/service.ts'],tests);
 assert.equal(p.typecheck,true);assert.deepEqual(p.lint,['packages/p2/service.ts']);
 assert.deepEqual(p.areas.map(a=>a.area),['registration']);
 assert.deepEqual(directTests(p),['tests/db/anc-owner-registry.test.ts','tests/db/p2-service.test.ts','tests/unit/p2-pdf.test.ts']);
 assert.equal(p.deployContracts,false);assert.equal(p.migration,false);
});
test('a PDF change selects the PDF suites; a worker change the queue suites',()=>{
 assert.deepEqual(directTests(selectChecks(['packages/pdf/p2.ts'],tests)),['tests/unit/p2-pdf.test.ts','tests/unit/pdf.test.ts']);
 assert.deepEqual(directTests(selectChecks(['apps/worker/main.ts'],tests)),['tests/unit/storage-worker.test.ts']);
});
test('a migration change selects the migration rehearsal and the database suites',()=>{
 const p=selectChecks(['db/migrations/181_x.sql'],tests);
 assert.equal(p.migration,true);assert.equal(p.typecheck,false);assert.deepEqual(p.lint,[]);
});
test('deployment, installer and dev-tool changes select the deployment contracts but never relate application tests',()=>{
 const p=selectChecks(['deploy/windows/deploy-gates.mjs','tools/dev/verify.mjs'],tests);
 assert.equal(p.deployContracts,true);assert.deepEqual(p.related,[]);
});
test('a changed test runs directly; documentation alone selects nothing to run',()=>{
 assert.deepEqual(selectChecks(['tests/db/migrations.test.ts'],tests).changedTests,['tests/db/migrations.test.ts']);
 const d=selectChecks(['docs/x.md','README.md'],tests);
 assert.equal(d.typecheck,false);assert.deepEqual(d.lint,[]);assert.equal(d.deployContracts,false);
 assert.equal(selectChecks([],tests).nothingToCheck,true);
});
test('dependency and build configuration changes select the build-input checks',()=>{
 assert.equal(selectChecks(['package-lock.json'],tests).buildInputs,true);
 assert.equal(selectChecks(['next.config.ts'],tests).typegen,true);
});
