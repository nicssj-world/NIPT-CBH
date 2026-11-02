import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
// Excel bridge reliability (Production evidence 2026-11-02: the instance ended with 0xC000013A and nothing started it again).
const engine=await readFile(new URL('../../tools/win-installer/nipt-admin.mjs',import.meta.url),'utf8');
const script=await readFile(new URL('../../tools/win-installer/Start-ExcelBridge.ps1',import.meta.url),'utf8');
test('the bridge task has no console to close, restarts itself every 2 minutes while none runs, and never runs two at once',()=>{
 const reg=engine.slice(engine.indexOf('function registerBridgeTask'),engine.indexOf('function bridgeStatus'));
 assert.match(reg,/-WindowStyle Hidden/);
 assert.match(reg,/New-ScheduledTaskTrigger -AtLogOn/);
 assert.match(reg,/New-ScheduledTaskTrigger -Once[^;]*-RepetitionInterval \(New-TimeSpan -Minutes 2\)/);
 assert.match(reg,/-MultipleInstances IgnoreNew/);
 assert.match(reg,/-ExecutionTimeLimit \(\[TimeSpan\]::Zero\)/);
});
test('a second session cannot start a second bridge: a machine-wide mutex per installation root, exit 0 when it is held',()=>{
 assert.match(script,/System\.Threading\.Mutex/);
 assert.match(script,/Global\\NIPT-CBH-ExcelBridge-/);
 assert.match(script,/if\(-not \$created\)\{exit 0\}/);
 // the mutex is taken before the bridge is started
 assert.ok(script.indexOf('System.Threading.Mutex')<script.indexOf('native-excel-bridge.ps1'));
});
