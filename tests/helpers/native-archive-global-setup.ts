import {spawnSync} from 'node:child_process';
import {existsSync,rmSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {randomBytes} from 'node:crypto';
import {Client} from 'pg';

/** Creates a temporary, isolated localhost-only PostgreSQL 17 cluster.
 * No existing database URL or hospital database may be used here.
 * The cluster and all synthetic records are removed after the suite. */
let root:string|null=null,pgctl:string|null=null;
const run=(exe:string,args:string[],timeout=30000)=>{
 const child=spawnSync(exe,args,{timeout,windowsHide:true,stdio:'ignore'});
 if(child.error||child.status!==0)throw Error('SYNTHETIC_POSTGRES_COMMAND_FAILED_'+path.basename(exe));
};
async function openPort(){
 const server=net.createServer();
 await new Promise<void>((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',()=>resolve()));
 const port=(server.address() as net.AddressInfo).port;
 await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
 return port;
}
export async function setup(){
 if(process.platform!=='win32')throw Error('SYNTHETIC_NATIVE_WINDOWS_HOST_REQUIRED');
 const bin=[process.env.NIPT_PG_HOME,'C:/Program Files/pgsql','C:/Program Files/PostgreSQL/17']
  .filter((v):v is string=>!!v).map(v=>path.join(v,'bin'))
  .find(v=>existsSync(path.join(v,'initdb.exe'))&&existsSync(path.join(v,'pg_ctl.exe')));
 if(!bin)throw Error('SYNTHETIC_NATIVE_PG_BINARIES_MISSING');
 const initdb=path.join(bin,'initdb.exe');pgctl=path.join(bin,'pg_ctl.exe');
 root=mkdtempSync(path.join(os.tmpdir(),'nipt-112-synthetic-native-'));
 const port=await openPort();
 try{
  run(initdb,['-D',root,'-A','trust','-U','postgres','-E','UTF8','--no-locale']);
  run(pgctl,['-D',root,'-l',path.join(root,'pg-server.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
  const serverUrl=`postgresql://postgres@127.0.0.1:${port}/postgres`;
  const dbName='nipt_synthetic_archive_'+randomBytes(4).toString('hex');
  const c=new Client({connectionString:serverUrl,connectionTimeoutMillis:5000});
  await c.connect();try{
   await c.query('CREATE DATABASE '+dbName);
   await c.query('CREATE DATABASE nipt_p6_synthetic_bootstrap');
  }finally{await c.end();}
  const p6TestUrl=`postgresql://postgres@127.0.0.1:${port}/nipt_p6_synthetic_bootstrap`;
  process.env.NIPT_P6_NATIVE_URL=p6TestUrl;
  const testUrl=`postgresql://postgres@127.0.0.1:${port}/${dbName}`;
  // This environment is supplied to Vitest's worker tests; never export or
  // reuse DATABASE_URL from the host.
  process.env.NIPT_TEST_DATABASE_URL=testUrl;
  process.env.NIPT_ARCHIVE_TEST_DATABASE_URL=testUrl;
  process.env.NIPT_MODE='synthetic';
  console.log('SYNTHETIC_NATIVE_POSTGRESQL_READY:',port);
 }catch(e){
  try{run(pgctl,['-D',root,'-m','immediate','-w','stop'],20000);}catch{}
  if(root)rmSync(root,{recursive:true,force:true});
  root=null;throw e;
 }
}
export async function teardown(){
 delete process.env.NIPT_P6_NATIVE_URL;
 delete process.env.NIPT_TEST_DATABASE_URL;
 delete process.env.NIPT_ARCHIVE_TEST_DATABASE_URL;
 if(pgctl&&root){
  try{run(pgctl,['-D',root,'-m','fast','-w','stop'],60000);}finally{
   if(!path.basename(root).startsWith('nipt-112-synthetic-native-'))throw Error('UNSAFE_SYNTHETIC_TEST_CLEANUP');
   rmSync(root,{recursive:true,force:true});
   root=null;
  }
 }
}
