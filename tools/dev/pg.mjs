// The development PostgreSQL: its own cluster in .local/dev/pgdata, 127.0.0.1:55452 only, small and capped, started/stopped with the PostgreSQL 17 binaries
// that are already on the machine. It is never a service, never listens on a LAN address and shares nothing with Staging (55442) or Production (55432).
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {DEV_HOME,DEV_PORTS,DEV_DATABASE} from './dev-env.mjs';

export const PG_DATA=path.join(DEV_HOME,'pgdata');
export const PG_LOG=path.join(DEV_HOME,'postgres.log');
export function pgBin(){
 const candidates=[process.env.NIPT_PG_HOME,'C:\\Program Files\\PostgreSQL\\17','C:\\Program Files\\pgsql'].filter(Boolean);
 for(const home of candidates){if(existsSync(path.join(home,'bin','pg_ctl.exe')))return path.join(home,'bin');}
 return null;
}
const run=(bin,exe,args)=>spawnSync(path.join(bin,exe),args,{encoding:'utf8',windowsHide:true});

// everything the cluster is allowed to use: a few connections and a small buffer, so development cannot starve the hospital services on the same host
const SETTINGS=[`port=${DEV_PORTS.postgres}`,"listen_addresses='127.0.0.1'",'max_connections=30','shared_buffers=64MB','work_mem=8MB','maintenance_work_mem=64MB','fsync=on',"log_min_messages='warning'"];

export function pgStatus(bin=pgBin()){
 if(!bin||!existsSync(path.join(PG_DATA,'PG_VERSION')))return 'absent';
 return run(bin,'pg_ctl.exe',['status','-D',PG_DATA]).status===0?'running':'stopped';
}
export function initCluster(bin){
 mkdirSync(DEV_HOME,{recursive:true});
 const r=run(bin,'initdb.exe',['-D',PG_DATA,'-U','nipt_dev','-A','trust','-E','UTF8','--locale=C']);
 if(r.status!==0)throw Error('INITDB_FAILED: '+(r.stderr||r.stdout).trim().slice(-400));
 writeFileSync(path.join(PG_DATA,'postgresql.auto.conf'),SETTINGS.map(s=>s.replace('=',' = ')).join('\n')+'\n',{flag:'a'});
}
export function startCluster(bin){
 // stdio must NOT be piped: the postgres process outlives pg_ctl and would keep the pipe open, so spawnSync would never return. Its output goes to PG_LOG.
 const r=spawnSync(path.join(bin,'pg_ctl.exe'),['start','-D',PG_DATA,'-l',PG_LOG,'-w','-t','60'],{stdio:'ignore',windowsHide:true});
 if(r.status!==0)throw Error(`PG_START_FAILED: pg_ctl exit ${r.status} (see ${PG_LOG})`);
}
export function stopCluster(bin){
 const r=run(bin,'pg_ctl.exe',['stop','-D',PG_DATA,'-m','fast','-w']);
 if(r.status!==0)throw Error('PG_STOP_FAILED: '+(r.stderr||r.stdout).trim().slice(-300));
}
export const adminUrl=`postgresql://nipt_dev@127.0.0.1:${DEV_PORTS.postgres}/postgres`;
export {DEV_DATABASE};
