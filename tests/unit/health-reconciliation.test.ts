import {it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({unresolved:1}));
vi.mock('../../packages/db/connection',()=>({pool:()=>({query:async(sql:string)=>{const now=new Date();if(sql.includes('worker_heartbeat'))return {rows:[{observed_at:now,details:{lastSuccess:now.toISOString(),lastError:null}}]};if(sql.includes("result->>'state'"))return {rows:[{count:String(state.unresolved),oldest:state.unresolved?now:null}]};return {rows:[{count:'0',oldest:null}]};}})}));
vi.mock('../../packages/settings/service',()=>({readActiveSettings:async()=>({his_inbound:{enabled:true,basePath:'simulator/inbound',section:'7',testCode:'70096',intervalSeconds:30,lookbackDays:7,secretRef:null}})}));
import {systemHealth} from '../../src/server/health';
it('durable reconciliation independently blocks health despite fresh successful heartbeat and empty backlog',async()=>{const h=await systemHealth();expect(h.Alive).toBe(true);expect(h.LastError).toBeNull();expect(h.backlog).toBe(0);expect(h.unresolvedReconciliation).toBe(1);expect(h.healthy).toBe(false);state.unresolved=0;expect((await systemHealth()).healthy).toBe(true);});
