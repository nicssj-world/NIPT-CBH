import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {loadRuntimeMaster} from '../../packages/workbook/runtime';
import {MASTER_SHA256} from '../../packages/workbook/master';
it('runtime template names the current combined master; loader rejects missing, network, missing-file and wrong-byte sources',async()=>{
 expect(await readFile('deploy/operational-runtime.example','utf8')).toContain('NIPT_TASK_MASTER_PATH=./data/templates/NIPT_CBH_Final_Combined_Master_2026-10-15.xlsx');
 await expect(loadRuntimeMaster({})).rejects.toThrow('TASK_MASTER_PATH_REQUIRED');
 await expect(loadRuntimeMaster({NIPT_TASK_MASTER_PATH:'//server/master.xlsx'})).rejects.toThrow('TASK_MASTER_LOCAL_PATH_REQUIRED');
 await expect(loadRuntimeMaster({NIPT_TASK_MASTER_PATH:'missing-master.xlsx'})).rejects.toThrow('TASK_MASTER_FILE_NOT_FOUND');
 await expect(loadRuntimeMaster({NIPT_TASK_MASTER_PATH:'package.json'})).rejects.toThrow('TASK_MASTER_SHA256_MISMATCH');
 expect(MASTER_SHA256).toBe('0f94efbc240b9a38ff9be77bf0c8d92c09d82fa2fe2427b9d274cc739e5607a6');
});
it.skipIf(!process.env.NIPT_TASK_MASTER_PATH)('configured owner master loads, while the explicitly supplied obsolete master is rejected',async()=>{
 const result=await loadRuntimeMaster({NIPT_TASK_MASTER_PATH:process.env.NIPT_TASK_MASTER_PATH});expect(result).toBeDefined();
 if(process.env.NIPT_TEST_OLD_MASTER_PATH)await expect(loadRuntimeMaster({NIPT_TASK_MASTER_PATH:process.env.NIPT_TEST_OLD_MASTER_PATH})).rejects.toThrow('TASK_MASTER_SHA256_MISMATCH');
});
