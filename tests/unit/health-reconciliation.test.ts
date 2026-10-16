import {beforeAll,it,expect,vi} from 'vitest';
import {readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const state=vi.hoisted(()=>({unresolved:1,ledger:[] as {name:string;checksum:string}[]}));
vi.mock('../../packages/db/connection',()=>({pool:()=>({query:async(sql:string)=>{
 const now=new Date();
 if(sql.includes('FROM worker_heartbeat WHERE'))return {rows:[{observed_at:now,details:{lastSuccess:now.toISOString(),lastError:null}}]};
 if(sql.includes("result->>'state'"))return {rows:[{count:String(state.unresolved),oldest:state.unresolved?now:null}]};
 if(sql.includes('nipt_operational_enabled()'))return {rows:[{operational:false,quarantined:false}]};
 if(sql.includes('FROM pg_locks'))return {rows:[{held:true}]};
 if(sql.includes('FROM schema_migration'))return {rows:state.ledger};
 if(sql.includes('FROM p6_transfer'))return {rows:[{retry:'0',unresolved:'0',worker_error:false}]};
 if(sql.includes('FROM his_inbound_scan_run'))return {rows:[]};
 return {rows:[{count:'0',oldest:null}]};
}})}));
vi.mock('../../packages/settings/service',()=>({readActiveSettings:async()=>({his_inbound:{enabled:true,basePath:'simulator/inbound',section:'7',testCode:'70096',intervalSeconds:30,lookbackDays:7,secretRef:null}})}));
import {systemHealth} from '../../src/server/health';
import {pool} from '../../packages/db/connection';
beforeAll(async()=>{for(const name of (await readdir('db/migrations')).filter(n=>n.endsWith('.sql')))state.ledger.push({name,checksum:createHash('sha256').update(await readFile('db/migrations/'+name,'utf8')).digest('hex')});});
it('durable reconciliation independently blocks health despite fresh successful heartbeat and empty backlog',async()=>{
 const h=await systemHealth(pool(),'synthetic','ALIVE');expect(h.Alive).toBe(true);expect(h.LastError).toBeNull();expect(h.backlog).toBe(0);expect(h.unresolvedReconciliation).toBe(1);expect(h.alerts).toContain('TRANSFER_RECONCILIATION');expect(h.healthy).toBe(false);
 state.unresolved=0;expect((await systemHealth(pool(),'synthetic','ALIVE')).healthy).toBe(true);
});
