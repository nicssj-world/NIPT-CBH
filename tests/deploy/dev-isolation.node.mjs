import {test} from 'node:test';
import assert from 'node:assert/strict';
import {devEnvironment,isolationViolations,DEV_HOME,DEV_PORTS,protectedTargets} from '../../tools/dev/dev-env.mjs';

const targets=protectedTargets('Z:\\no-such-dir');   // built-in list only: the test must not depend on this machine
const codes=env=>isolationViolations(env,{targets}).map(v=>v.code);
const good=()=>({...devEnvironment()});

test('the built-in development environment is isolated and uses ports no installed environment uses',()=>{
 assert.deepEqual(isolationViolations(good(),{targets}),[]);
 for(const p of Object.values(DEV_PORTS))assert.equal(targets.ports.has(p),false,String(p));
});
test('Production and Staging ports are refused for database, web and renderer',()=>{
 assert.ok(codes({...good(),DATABASE_URL:'postgresql://nipt_dev@127.0.0.1:55432/nipt_synthetic_dev'}).includes('DEV_PORT_BELONGS_TO_STAGING_OR_PRODUCTION'));
 assert.ok(codes({...good(),DATABASE_URL:'postgresql://nipt_dev@127.0.0.1:55442/nipt_synthetic_dev'}).includes('DEV_PORT_BELONGS_TO_STAGING_OR_PRODUCTION'));
 assert.ok(codes({...good(),APP_ORIGIN:'http://127.0.0.1:3000'}).includes('DEV_PORT_BELONGS_TO_STAGING_OR_PRODUCTION'));
 assert.ok(codes({...good(),RENDERER_URL:'http://127.0.0.1:3011'}).includes('DEV_PORT_BELONGS_TO_STAGING_OR_PRODUCTION'));
});
test('only loopback hosts and the reserved database name are accepted',()=>{
 assert.ok(codes({...good(),DATABASE_URL:'postgresql://u@192.168.72.194:55452/nipt_synthetic_dev'}).includes('DEV_HOST_MUST_BE_LOOPBACK'));
 assert.ok(codes({...good(),DATABASE_URL:'postgresql://u@127.0.0.1:55452/nipt_cbh'}).includes('DEV_DATABASE_NAME_MUST_BE_RESERVED'));
 assert.ok(codes({...good(),DATABASE_URL:'postgresql://u@127.0.0.1:55452/nipt_synthetic_p1'}).includes('DEV_DATABASE_NAME_MUST_BE_RESERVED'));
});
test('paths must be local, inside the development home and outside the installed environments',()=>{
 assert.ok(codes({...good(),FILE_STORE_ROOT:'\\\\nas01\\results'}).includes('DEV_PATH_MUST_BE_LOCAL_ABSOLUTE'));
 assert.ok(codes({...good(),SIMULATOR_ROOT:'C:\\NIPT-CBH\\production\\data'}).includes('DEV_PATH_INSIDE_PROTECTED_ROOT'));
 assert.ok(codes({...good(),FILE_STORE_ROOT:'C:\\temp\\files'}).includes('DEV_PATH_OUTSIDE_DEV_HOME'));
 assert.ok(codes({...good(),FILE_STORE_ROOT:DEV_HOME+'-evil\\files'}).includes('DEV_PATH_OUTSIDE_DEV_HOME'));
});
test('synthetic mode is required and no installed-environment, HIS or operational variable may be inherited',()=>{
 assert.ok(codes({...good(),NIPT_MODE:'operational'}).includes('DEV_SYNTHETIC_MODE_REQUIRED'));
 assert.ok(codes({...good(),NIPT_ENVIRONMENT:'production'}).includes('DEV_MUST_NOT_RUN_AS_INSTALLED_ENVIRONMENT'));
 assert.ok(codes({...good(),NIPT_OPERATIONAL_DATABASE:'nipt_cbh'}).includes('DEV_HIS_OR_OPERATIONAL_VARIABLE_FORBIDDEN'));
 assert.ok(codes({...good(),HIS_OUTBOUND_ROOT:'\\\\his\\out'}).includes('DEV_HIS_OR_OPERATIONAL_VARIABLE_FORBIDDEN'));
});
test('installed Staging/Production definitions on the machine add their ports and roots',()=>{
 const t=protectedTargets();   // reads the real definitions when present; always a superset of the built-ins
 for(const p of [3000,3001,3010,3011,55432,55442])assert.ok(t.ports.has(p));
});
