import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ownerTemplatePath,OWNER_TEMPLATE_FILES} from '../../packages/lab/owner-templates';
import {POOL_CSV_SHA256} from '../../packages/pooling/owner-master';
import {NIFTY_TEMPLATE_SHA256} from '../../packages/sequencing/owner-export';
import {TASK_IMPORT_TEMPLATE_SHA256} from '../../packages/sequencing/owner-task-import';

it('templates are found next to the master workbook when no variable is set; an explicit variable wins; nothing found gives null',()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'nipt-tpl-')),master=path.join(dir,'approved-master.xlsx');
 expect(ownerTemplatePath('NIPT_NIFTY_XLSX_TEMPLATE',{NIPT_TASK_MASTER_PATH:master})).toBeNull();
 expect(ownerTemplatePath('NIPT_NIFTY_XLSX_TEMPLATE',{})).toBeNull();
 for(const f of Object.values(OWNER_TEMPLATE_FILES))writeFileSync(path.join(dir,f),'x');
 expect(ownerTemplatePath('NIPT_NIFTY_XLSX_TEMPLATE',{NIPT_TASK_MASTER_PATH:master})).toBe(path.join(dir,'nifty.xlsx'));
 expect(ownerTemplatePath('NIPT_HALOS_TASK_TEMPLATE',{NIPT_TASK_MASTER_PATH:master})).toBe(path.join(dir,'halos-task.xlsx'));
 expect(ownerTemplatePath('NIPT_POOL_CSV_TEMPLATE',{NIPT_TASK_MASTER_PATH:master})).toBe(path.join(dir,'pooling.csv'));
 expect(ownerTemplatePath('NIPT_NIFTY_XLSX_TEMPLATE',{NIPT_TASK_MASTER_PATH:master,NIPT_NIFTY_XLSX_TEMPLATE:'C:/explicit/n.xlsx'})).toBe('C:/explicit/n.xlsx');
});
it('the provisioning script pins exactly the hashes the application verifies, for the file names the application looks for',()=>{
 const script=readFileSync('deploy/windows/provision-export-templates.ps1','utf8');
 const pinned:Record<string,string>={[OWNER_TEMPLATE_FILES.NIPT_POOL_CSV_TEMPLATE]:POOL_CSV_SHA256,[OWNER_TEMPLATE_FILES.NIPT_NIFTY_XLSX_TEMPLATE]:NIFTY_TEMPLATE_SHA256,[OWNER_TEMPLATE_FILES.NIPT_HALOS_TASK_TEMPLATE]:TASK_IMPORT_TEMPLATE_SHA256};
 for(const [name,hash] of Object.entries(pinned)){
  const line=script.split(/\r?\n/).find(l=>l.includes(`'${name}'`)&&l.includes('='));
  expect(line,name).toBeDefined();expect(line).toContain(`'${hash}'`);
 }
});
