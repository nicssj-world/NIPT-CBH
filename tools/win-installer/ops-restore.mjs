// Runs in the release `ops` folder. restore: verified restore into a NEW quarantined database and file tree.
// activate: persistently fence the source, then activate the restored target (explicit operator step).
import {operationalRestore,activateRestored} from '../../deploy/scripts/operational-backup.mjs';
const [command,a,b]=process.argv.slice(2);
if(command==='restore'&&a&&b)process.stdout.write(JSON.stringify(await operationalRestore(a,b,process.env))+'\n');
else if(command==='activate'&&a){await activateRestored(a,process.env);process.stdout.write(JSON.stringify({activated:true})+'\n');}
else throw Error('USAGE_RESTORE_OR_ACTIVATE');
