import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase,addUser} from '../helpers/database';
import type {Principal} from '../../packages/security/policy';
import {saveHisPaths} from '../../packages/settings/his-paths';
import {checkHisSetting} from '../../packages/settings/his-check';
import {resultFolderSettingValid} from '../../packages/results/folder';
import {readActiveSettings} from '../../packages/settings/service';

// VERIFY ONLY (Owner): the current HIS path save on isolated synthetic folders. No real share, service identity or setting is touched.
let db:PGlite,admin:Principal,root:string;
const dirs={} as Record<'res'|'cfsPdf'|'backup',string>;
const deps={resultFolderValid:(d:string)=>resultFolderSettingValid('unused',d),check:checkHisSetting};
const active=async()=>(await readActiveSettings(db)).his_outbound as Record<string,unknown>|undefined;
beforeAll(async()=>{
 root=await fs.mkdtemp(path.join(os.tmpdir(),'nipt-113-his-regress-'));
 for(const k of ['res','cfsPdf','backup'] as const){dirs[k]=path.join(root,k);await fs.mkdir(dirs[k]);}
 vi.stubEnv('NIPT_MODE','operational');vi.stubEnv('APP_ORIGIN','https://nipt-cbh');vi.stubEnv('NIPT_HIS_SHARE_POLICY_ENFORCE','0');vi.stubEnv('NIPT_HIS_SHARE_POLICY_FILE','');
 db=await testDatabase();admin=await addUser(db,'APP_ADMIN','synthetic.hispath.regress113');
});
afterAll(async()=>{await db?.close();vi.unstubAllEnvs();if(root?.includes('nipt-113-his-regress-'))await fs.rm(root,{recursive:true,force:true});});

it('all three destinations accessible (the Production situation): each can be changed and saved, probes leave nothing behind',async()=>{
 await saveHisPaths(db,admin,{paths:{res:dirs.res,cfsPdf:dirs.cfsPdf,backup:dirs.backup}},deps);
 const other=path.join(root,'backup2');await fs.mkdir(other);
 await saveHisPaths(db,admin,{paths:{backup:other}},deps);
 expect((await active())?.backupPath).toBe(other);
 for(const d of [dirs.res,dirs.cfsPdf,other])expect(await fs.readdir(d)).toEqual([]);
 await expect(checkHisSetting('his_outbound',(await active())!)).resolves.toBeUndefined();
});

it('the full pre-transfer readiness check still rejects an inaccessible destination',async()=>{
 const now={...(await active())!,resDestinationPath:path.join(root,'gone')};
 await expect(checkHisSetting('his_outbound',now as never)).rejects.toThrow(/SHARE_|HIS_PATH/);
});

it('EDGE CASE: changing ONE path saves even when another UNCHANGED path is currently unreachable; the pre-transfer readiness still rejects',async()=>{
 await fs.rm(dirs.res,{recursive:true,force:true});                       // the unchanged RES destination becomes unreachable
 const next=path.join(root,'backup3');await fs.mkdir(next);
 await saveHisPaths(db,admin,{paths:{backup:next}},deps);
 const now=(await active())!;
 expect(now.backupPath).toBe(next);
 expect(now.resDestinationPath).toBe(dirs.res);                           // the unreachable path is not silently changed
 await expect(checkHisSetting('his_outbound',now as never)).rejects.toThrow(/SHARE_|HIS_PATH/);   // full readiness (what gates a transfer) is unchanged
 expect(await fs.readdir(next)).toEqual([]);
});
it('a changed destination that is itself unreachable is still refused and changes nothing; unknown field names fail closed',async()=>{
 const before=await active();
 await expect(saveHisPaths(db,admin,{paths:{res:path.join(root,'also-gone')}},deps)).rejects.toThrow(/SHARE_PATH_NOT_FOUND/);
 expect(await active()).toEqual(before);
 await expect(checkHisSetting('his_outbound',before as never,['notAPathField'])).rejects.toThrow('INVALID_HIS_PATH_FIELD');
 await fs.mkdir(dirs.res);
 await expect(checkHisSetting('his_outbound',(await active())! as never)).resolves.toBeUndefined();
});
