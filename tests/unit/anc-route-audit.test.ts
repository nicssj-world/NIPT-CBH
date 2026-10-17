import {beforeEach,describe,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const calls=vi.hoisted(()=>({protect:vi.fn(),dashboard:vi.fn(),audit:vi.fn(),query:vi.fn(),events:[] as string[]}));
vi.mock('../../src/server/http',()=>({protect:calls.protect}));
vi.mock('../../packages/anc/service',()=>({dashboard:calls.dashboard}));
vi.mock('../../packages/db/phi-access',()=>({recordPhiAccess:calls.audit}));
vi.mock('../../packages/db/connection',()=>({withTransaction:async(body:(db:{query:typeof calls.query})=>Promise<unknown>)=>body({query:calls.query})}));
import {GET} from '../../src/app/api/anc/dashboard/route';
const result={queue:{items:[{id:'00000000-0000-4000-8000-000000000001',ln:'000099900001'}]}};
beforeEach(()=>{vi.clearAllMocks();calls.events.length=0;calls.protect.mockResolvedValue({id:'actor'});calls.query.mockResolvedValue({rows:[]});calls.dashboard.mockImplementation(async()=>{calls.events.push('snapshot');return result});calls.audit.mockImplementation(async()=>{calls.events.push('audit')})});
describe('ANC route PHI audit boundary',()=>{
 it('audits only authorized queue IDs before returning identifiers and never caches',async()=>{const r=await GET(new NextRequest('http://127.0.0.1/api/anc/dashboard'));expect(r.status).toBe(200);expect(calls.events).toEqual(['snapshot','audit']);expect(calls.query).toHaveBeenCalledWith('SET TRANSACTION READ ONLY');expect(calls.audit).toHaveBeenCalledWith(expect.anything(),'actor',[result.queue.items[0].id],'REGISTRY_VIEW');expect(r.headers.get('cache-control')).toContain('no-store');expect((await r.json()).queue.items[0].ln).toBe('000099900001')});
 it('fails closed without identifiers if access-audit insert fails',async()=>{calls.audit.mockRejectedValue(new Error('AUDIT_INSERT_FAILED'));const r=await GET(new NextRequest('http://127.0.0.1/api/anc/dashboard'));expect(r.status).toBeGreaterThanOrEqual(400);const body=await r.text();expect(body).not.toContain(result.queue.items[0].id);expect(body).not.toContain(result.queue.items[0].ln)});
 it('unauthenticated requests cannot project or audit any case',async()=>{calls.protect.mockRejectedValue(new Error('UNAUTHENTICATED'));const r=await GET(new NextRequest('http://127.0.0.1/api/anc/dashboard'));expect(r.status).toBe(401);expect(calls.dashboard).not.toHaveBeenCalled();expect(calls.audit).not.toHaveBeenCalled()});
});
