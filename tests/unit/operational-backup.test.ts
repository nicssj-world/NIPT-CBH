import {it,expect} from 'vitest';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {encryptFile,decryptFile,validatePolicyTarget} from '../../deploy/scripts/operational-backup.mjs';
it('streams authenticated encrypted files, detects tampering and never overwrites an existing restore artifact',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'nipt-stream-'));try{const key=randomBytes(32),source=path.join(root,'source'),cipher=path.join(root,'cipher'),target=path.join(root,'target');await writeFile(source,randomBytes(1024*1024));const result=await encryptFile(source,cipher,key,'test');await decryptFile(cipher,target,key,'test',result);expect(await readFile(target)).toEqual(await readFile(source));await expect(decryptFile(cipher,target,key,'test',result)).rejects.toThrow();const bytes=await readFile(cipher);bytes[100]^=1;await writeFile(cipher,bytes);await expect(decryptFile(cipher,path.join(root,'bad'),key,'test',result)).rejects.toThrow();}finally{await rm(root,{recursive:true,force:true});}
});
it('requires deployment-owned matching service identity, database and contained backup/restore targets',()=>{
 const root=path.resolve('.local/backup-test');const policy={version:1,serviceAccount:'account',sourceDatabase:'nipt_operational_test',backupRoot:root,restoreRoot:path.resolve('.local/restore-test'),restoreDatabasePrefix:'nipt_operational_restore_'};
 expect(()=>validatePolicyTarget(policy,'other','nipt_operational_test',root,'backup')).toThrow('OPERATIONS_IDENTITY_MISMATCH');
 expect(()=>validatePolicyTarget(policy,'account','production',root,'backup')).toThrow('OPERATIONS_DATABASE_MISMATCH');
 expect(()=>validatePolicyTarget(policy,'account','nipt_operational_test',path.resolve('.local/backup-test-sibling'),'backup')).toThrow('OPERATIONS_TARGET_OUTSIDE_POLICY');
 expect(validatePolicyTarget(policy,'account','nipt_operational_test',path.join(root,'run'),'backup')).toBe(true);
});
