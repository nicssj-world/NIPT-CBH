import {it,expect,vi} from 'vitest';
import {testDatabase} from '../helpers/database';
import {assertDatabaseMode} from '../../packages/db/connection';
it('restored operational runtimes fail closed on missing/fenced rows; runtime groups cannot clear the operator quarantine',async()=>{
 const db=await testDatabase();try{await db.query("UPDATE nipt_runtime_config SET mode='operational'");vi.stubEnv('NIPT_MODE','operational');await expect(assertDatabaseMode(db)).resolves.toBeUndefined();await db.query('UPDATE nipt_restore_state SET quarantined=true');await expect(assertDatabaseMode(db)).rejects.toThrow('RESTORED_RUNTIME_QUARANTINED');await db.query('DELETE FROM nipt_restore_state');await expect(assertDatabaseMode(db)).rejects.toThrow('RESTORED_RUNTIME_QUARANTINED');await db.query('CREATE ROLE app_rw');await db.query('CREATE ROLE worker_rw');await db.query('GRANT EXECUTE ON FUNCTION nipt_runtime_quarantined() TO app_rw,worker_rw');await db.query('SET ROLE app_rw');await expect(db.query('INSERT INTO nipt_restore_state(singleton,quarantined) VALUES(true,false)')).rejects.toThrow(/permission denied/);await db.query('RESET ROLE');}finally{vi.unstubAllEnvs();await db.close();}
});
