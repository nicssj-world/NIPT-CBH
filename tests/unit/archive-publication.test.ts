import {expect,it} from 'vitest';
import {publishNoClobber} from '../../packages/results/archive-core';
it('fails closed with an actionable diagnostic when hard links are unsupported',async()=>{
 const unsupported=Object.assign(new Error('unsupported'),{code:'ENOTSUP'});
 await expect(publishNoClobber('stage','destination','0'.repeat(64),async()=>{throw unsupported;})).rejects.toThrow('ARCHIVE_PUBLICATION_UNSUPPORTED');
});
