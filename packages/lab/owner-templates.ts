import {existsSync} from 'node:fs';
import path from 'node:path';
/** The owner's approved export templates (each pinned by SHA-256 where it is read). An explicit environment variable wins; otherwise the file next to the approved
 * master workbook is used (the installation keeps both in its persistent data\master folder, so an application-only upgrade never loses them). */
export const OWNER_TEMPLATE_FILES={NIPT_POOL_CSV_TEMPLATE:'pooling.csv',NIPT_NIFTY_XLSX_TEMPLATE:'nifty.xlsx',NIPT_HALOS_TASK_TEMPLATE:'halos-task.xlsx'} as const;
export function ownerTemplatePath(envName:keyof typeof OWNER_TEMPLATE_FILES,env:Record<string,string|undefined>=process.env):string|null{
 const explicit=env[envName];if(explicit)return explicit;
 const master=env.NIPT_TASK_MASTER_PATH;if(!master)return null;
 const sibling=path.join(path.dirname(master),OWNER_TEMPLATE_FILES[envName]);
 return existsSync(sibling)?sibling:null;
}
