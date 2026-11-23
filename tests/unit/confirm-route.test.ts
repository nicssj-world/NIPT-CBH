import {beforeEach,describe,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const calls=vi.hoisted(()=>({protect:vi.fn(),detail:vi.fn(),stats:vi.fn(),query:vi.fn()}));
vi.mock('../../src/server/http',async original=>({...(await original<typeof import('../../src/server/http')>()),protect:calls.protect}));
vi.mock('../../packages/confirm/service',()=>({confirmBoard:vi.fn(),confirmDetail:calls.detail}));
vi.mock('../../packages/confirm/stats',()=>({confirmStats:calls.stats}));
vi.mock('../../packages/db/connection',()=>({withTransaction:async(body:(db:object)=>Promise<unknown>)=>body({query:calls.query})}));
import {GET} from '../../src/app/api/confirm/route';

const get=(qs:string)=>GET(new NextRequest('http://127.0.0.1/api/confirm'+qs));
beforeEach(()=>{vi.clearAllMocks();calls.protect.mockResolvedValue({id:'actor'});calls.detail.mockResolvedValue({row:{},history:[]});calls.stats.mockResolvedValue({});});

describe('Confirm GET route',()=>{
 it('opening a case is not read-only: it records PHI access with an INSERT (Production 2026-11-23)',async()=>{
  const r=await get('?caseId=c1');expect(r.status).toBe(200);
  expect(calls.query).not.toHaveBeenCalledWith(expect.stringMatching(/READ ONLY/i));expect(calls.detail).toHaveBeenCalled();
 });
 it('the counts-only stats view stays read-only',async()=>{
  const r=await get('?view=stats');expect(r.status).toBe(200);
  expect(calls.query).toHaveBeenCalledWith(expect.stringMatching(/READ ONLY/i));expect(calls.stats).toHaveBeenCalled();
 });
});
