import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../',import.meta.url));
const hookConfig = JSON.parse(readFileSync(new URL('../../.codex/hooks.json',import.meta.url),'utf8'));
const handler = hookConfig.hooks.PreToolUse[0];
const command = handler.hooks[0];
const hookPath = fileURLToPath(new URL('../../tools/dev/enforce-fast-loop.mjs',import.meta.url));

test('Codex PreToolUse matches shell commands and resolves hook via git root on Windows',()=>{
  assert.equal(handler.matcher,'^Bash$');
  assert.equal(command.type,'command');
  assert.match(command.command,/git rev-parse --show-toplevel/);
  assert.match(command.commandWindows,/powershell -NoProfile/);
  assert.match(command.commandWindows,/git rev-parse --show-toplevel/);
  assert.match(command.commandWindows,/enforce-fast-loop\.mjs/);
  assert.notEqual(command.async,true);
});

function simulate(input) {
  const result=spawnSync(process.execPath,[hookPath],{
    cwd:root,
    encoding:'utf8',
    input:JSON.stringify({hook_event_name:'PreToolUse',tool_name:'Bash',tool_input:{command:input}})
  });
  assert.equal(result.status,0,result.stderr);
  return result.stdout.trim()?JSON.parse(result.stdout):null;
}
test('Codex hook denies expensive direct commands',()=>{
  const result=simulate('npm test');
  assert.equal(result.hookSpecificOutput.hookEventName,'PreToolUse');
  assert.equal(result.hookSpecificOutput.permissionDecision,'deny');
  assert.match(result.hookSpecificOutput.permissionDecisionReason,/npm run dev:verify/);
});
test('Codex hook permits focused loop and release preflight entrypoint',()=>{
  assert.equal(simulate('npm run dev:verify'),null);
  assert.equal(simulate('npm run dev:test -- tests/unit/example.test.ts'),null);
  assert.equal(simulate('npm run release:preflight -- --full'),null);
});
