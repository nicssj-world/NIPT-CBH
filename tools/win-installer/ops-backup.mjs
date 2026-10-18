// Runs in the release `ops` folder (so `pg` resolves). Thin CLI over the existing operational backup tool; the environment carries the policy.
import {operationalBackup} from '../../deploy/scripts/operational-backup.mjs';
const [command,output]=process.argv.slice(2);
if(command!=='backup'||!output)throw Error('USAGE_BACKUP_OUTPUT_REQUIRED');
process.stdout.write(JSON.stringify(await operationalBackup(output,process.env))+'\n');
