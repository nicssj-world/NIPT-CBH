import {afterEach,expect,it,vi} from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {SETTINGS} from '../../packages/settings/catalog';
import {checkHisSetting} from '../../packages/settings/his-check';
import {workerServiceAccount} from '../../packages/integrations/authorized-share';

const created:string[]=[];
afterEach(async()=>{vi.unstubAllEnvs();for(const d of created.splice(0))await fs.rm(d,{recursive:true,force:true});});

async function folders(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'nipt-113-his-'));created.push(root);
 const backup=path.join(root,'backup');
 await fs.mkdir(backup);
 vi.stubEnv('NIPT_MODE','operational');
 vi.stubEnv('APP_ORIGIN','https://nipt-cbh');
 vi.stubEnv('NIPT_HIS_SHARE_POLICY_ENFORCE','0');
 vi.stubEnv('NIPT_HIS_SHARE_POLICY_FILE','');
 return {root,backup,config:{...SETTINGS.his_outbound.default,resDestinationPath:path.join(root,'missing-res'),pdfDestinationPath:path.join(root,'missing-cfs'),backupPath:backup}};
}
it('P0: changing Backup alone probes Backup, not unchanged inaccessible RES/CFS',async()=>{
 const f=await folders();
 await expect(checkHisSetting('his_outbound',f.config,['backupPath'])).resolves.toBeUndefined();
 expect((await fs.readdir(f.backup)).filter(x=>x.startsWith('.nipt-connection-probe-'))).toEqual([]);
});
it('P0: full pre-transfer validation still rejects an inaccessible RES',async()=>{
 const f=await folders();
 await expect(checkHisSetting('his_outbound',f.config)).rejects.toMatchObject({message:'SHARE_PATH_NOT_FOUND',pathType:'RES'});
});
it('P0: saving multiple changed paths validates every changed path and identifies failing CFS',async()=>{
 const f=await folders();
 await expect(checkHisSetting('his_outbound',f.config,['backupPath','pdfDestinationPath'])).rejects.toMatchObject({message:'SHARE_PATH_NOT_FOUND',pathType:'CFS_PDF'});
});
it('P0: unknown path keys never bypass validation',async()=>{
 const f=await folders();
 await expect(checkHisSetting('his_outbound',f.config,['unexpected'])).rejects.toThrow('INVALID_HIS_PATH_FIELD');
});

it('P0: enforced share policy succeeds using the current Windows service account, no access to other paths',async()=>{
 const f=await folders();
 const file=path.join(f.root,'policy.json');
 await fs.writeFile(file,JSON.stringify({version:1,grants:[{root:f.root,purposes:['OUTBOUND'],serviceAccount:workerServiceAccount(),secretRef:null,mode:'operational'}]}));
 vi.stubEnv('NIPT_HIS_SHARE_POLICY_ENFORCE','1');vi.stubEnv('NIPT_HIS_SHARE_POLICY_FILE',file);
 await expect(checkHisSetting('his_outbound',f.config,['backupPath'])).resolves.toBeUndefined();
 expect(await fs.readdir(f.backup)).toEqual([]);
 await expect(checkHisSetting('his_outbound',f.config)).rejects.toMatchObject({message:'SHARE_PATH_NOT_FOUND',pathType:'RES'});
});
it('P0: changing one path is rejected when Windows Worker identity differs from the configured share policy',async()=>{
 const f=await folders();
 const file=path.join(f.root,'policy.json');
 await fs.writeFile(file,JSON.stringify({version:1,grants:[{root:f.root,purposes:['OUTBOUND'],serviceAccount:'NOT_THIS_WINDOWS_ACCOUNT',secretRef:null,mode:'operational'}]}));
 vi.stubEnv('NIPT_HIS_SHARE_POLICY_ENFORCE','1');vi.stubEnv('NIPT_HIS_SHARE_POLICY_FILE',file);
 await expect(checkHisSetting('his_outbound',f.config,['backupPath'])).rejects.toMatchObject({message:'SHARE_SERVICE_ACCOUNT_MISMATCH',pathType:'BACKUP'});
 expect(await fs.readdir(f.backup)).toEqual([]);
});
