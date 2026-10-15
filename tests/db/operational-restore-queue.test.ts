import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {restoreQueueAccess} from '../../deploy/scripts/operational-backup.mjs';
it('restoring under a different owner reauthorizes the Worker queue without granting application access or ownership',async()=>{
 const db=new PGlite();try{await db.exec('CREATE ROLE worker_rw; CREATE ROLE app_rw; CREATE SCHEMA pgboss; CREATE TABLE pgboss.job(id serial PRIMARY KEY,state text);');
 await db.query('SET ROLE worker_rw');await expect(db.query("INSERT INTO pgboss.job(state) VALUES('created')")).rejects.toThrow(/permission denied/);await db.query('RESET ROLE');
 await restoreQueueAccess(db);await restoreQueueAccess(db);await db.query('SET ROLE worker_rw');await db.query("INSERT INTO pgboss.job(state) VALUES('created')");await db.query("UPDATE pgboss.job SET state='completed'");expect((await db.query('SELECT state FROM pgboss.job')).rows).toEqual([{state:'completed'}]);await expect(db.query('CREATE TABLE pgboss.escalation(id int)')).rejects.toThrow(/permission denied/);await expect(db.query('TRUNCATE pgboss.job')).rejects.toThrow(/permission denied/);await expect(db.query('DROP TABLE pgboss.job')).rejects.toThrow(/must be owner/);await db.query('RESET ROLE');await db.query('SET ROLE app_rw');await expect(db.query('SELECT * FROM pgboss.job')).rejects.toThrow(/permission denied/);
 }finally{await db.close();}
});
