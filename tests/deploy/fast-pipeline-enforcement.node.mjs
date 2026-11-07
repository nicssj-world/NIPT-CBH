import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessCommand,hookDecision} from '../../tools/dev/enforce-fast-loop.mjs';
import {chooseValidation} from '../../tools/ci/plan-validation.mjs';

test('focused and authorized release entrypoints are not blocked by the hook',()=>{
  for(const command of ['npm run dev','npm run dev:verify','npm run dev:test -- tests/unit/x.test.ts',
    'npm run release:preflight','npm run release:preflight -- --full','npm ci',
    'npm run typecheck','npm run lint','npx vitest run tests/unit/x.test.ts',
    'npx playwright test tests/e2e/x.spec.ts'])
    assert.equal(assessCommand(command),null,command);
});
test('common slow direct development commands are denied',()=>{
  for(const command of ['npm test','npm run test:unit','npm run test:after-build',
    'npm run test:e2e','cd app && npm run build','npx next build',
    'npx vitest run','npx playwright test',
    'node --import tsx tools/win-installer/build-package.ts','docker compose up -d --build']){
    assert.ok(assessCommand(command),command);
    assert.equal(hookDecision(command).hookSpecificOutput.permissionDecision,'deny',command);
  }
});
test('unmatched command does not gain automatic permission',()=>assert.equal(hookDecision('git status'),null));
test('CI shares the Production risk classification with full tests on MEDIUM/HIGH',()=>{
  assert.equal(chooseValidation(['src/components/p2/widget.tsx']).runFull,false);
  assert.equal(chooseValidation(['packages/pdf/render.ts']).level,'MEDIUM');
  assert.equal(chooseValidation(['packages/pdf/render.ts']).runFull,true);
  assert.equal(chooseValidation(['db/migrations/200_x.sql']).level,'HIGH');
  assert.equal(chooseValidation(['.github/workflows/foundation.yml']).runFull,true);
  assert.equal(chooseValidation(['unknown/new/file']).level,'HIGH');
  assert.equal(chooseValidation([]).runFull,true);
  assert.equal(chooseValidation(['docs/note.md'],{manual:true}).runFull,true);
});
