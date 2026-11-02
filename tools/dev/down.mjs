// npm run dev:down — stop the development PostgreSQL (127.0.0.1:55452). Only the cluster in .local/dev/pgdata can be addressed.
import {pgBin,pgStatus,stopCluster} from './pg.mjs';
const bin=pgBin();
const state=pgStatus(bin);
if(state!=='running'){process.stdout.write(`development PostgreSQL is ${state}; nothing to stop\n`);process.exit(0);}
stopCluster(bin);process.stdout.write('development PostgreSQL stopped (data kept in .local/dev/pgdata)\n');
