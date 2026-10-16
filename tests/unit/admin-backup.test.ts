import {it,expect} from 'vitest';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {publishOperationsStatus,readOperationsStatus,databaseFingerprint} from '../../deploy/scripts/operations-status.mjs';
import {backupMonitoring} from '../../packages/admin/backup';
it('accepts only signed, target-bound operator completion; missing/tampered files never imply backup success',async()=>{
 const root=await mkdtemp(join(tmpdir(),'nipt-ops-status-'));try{const pair=generateKeyPairSync('ed25519'),key=join(root,'private.pem'),pub=join(root,'public.pem'),file=join(root,'status.json'),url='postgresql://owner@127.0.0.1:5432/nipt_test_operational';await writeFile(key,pair.privateKey.export({type:'pkcs8',format:'pem'}));await writeFile(pub,pair.publicKey.export({type:'spki',format:'pem'}));const env={NIPT_MODE:'operational',DATABASE_URL:url,NIPT_OPERATIONS_STATUS_FILE:file,NIPT_OPERATIONS_STATUS_SIGNING_KEY_FILE:key,NIPT_OPERATIONS_STATUS_PUBLIC_KEY_FILE:pub};
 expect((await backupMonitoring(env)).status).toBe('NOT VERIFIED');const result={createdAt:new Date().toISOString(),manifestSha256:'a'.repeat(64)};
 expect(await publishOperationsStatus('backup',result,env)).toEqual({status:'PUBLISHED'});expect((await backupMonitoring(env)).lastSuccessfulBackup).toBe(result.createdAt);expect((await backupMonitoring(env)).integrity).toContain('CREATION_VERIFIED');
 expect(await publishOperationsStatus('restore',{...result,restoreVerified:false},env)).toEqual({status:'NOT VERIFIED'});
 expect(await publishOperationsStatus('restore',{...result,restoreVerified:true,sourceFingerprint:databaseFingerprint(url)},env)).toEqual({status:'PUBLISHED'});expect((await backupMonitoring(env)).integrity).toBe('RESTORE_VERIFIED');
 await expect(readOperationsStatus(file,pub,databaseFingerprint(url+'other'))).rejects.toThrow();const raw=JSON.parse(await readFile(file,'utf8'));raw.payload.backup.at='2000-01-01T00:00:00Z';await writeFile(file,JSON.stringify(raw));expect((await backupMonitoring(env)).lastSuccessfulBackup).toBeNull();expect((await backupMonitoring(env)).status).toBe('NOT VERIFIED');
 expect((await backupMonitoring({})).status).toBe('NOT CONFIGURED');
 }finally{await rm(root,{recursive:true,force:true});}
});
