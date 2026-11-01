// Runs in the release `ops` folder (so `pg` resolves). Thin CLI over the existing operational backup tool; the environment carries the policy.
import {operationalBackup} from '../../deploy/scripts/operational-backup.mjs';
import {publishOperationsStatus} from '../../deploy/scripts/operations-status.mjs';
const [command,output]=process.argv.slice(2);
if(command!=='backup'||!output)throw Error('USAGE_BACKUP_OUTPUT_REQUIRED');
const receipt=await operationalBackup(output,process.env);
// The signed receipt attests a completed, verified backup; the historical migration reads it before it will Execute.
const published=await publishOperationsStatus('backup',receipt,process.env);
process.stdout.write(JSON.stringify({...receipt,operationsStatus:published.status})+'\n');
