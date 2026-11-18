import {beforeEach,describe,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const calls=vi.hoisted(()=>({protect:vi.fn(),preview:vi.fn(),apply:vi.fn()}));
vi.mock('../../src/server/http',async original=>({...(await original<typeof import('../../src/server/http')>()),protect:calls.protect}));
vi.mock('../../packages/his-anc/import',()=>({previewHisAnc:calls.preview,applyHisAnc:calls.apply}));
vi.mock('../../packages/db/connection',()=>({withTransaction:async(body:(db:object)=>Promise<unknown>)=>body({})}));
vi.mock('node:fs/promises',async original=>({...(await original<typeof import('node:fs/promises')>()),readFile:vi.fn(async()=>Buffer.alloc(32,7))}));
import {POST} from '../../src/app/api/lab/his-anc-import/route';
import {HisAncError} from '../../packages/his-anc/parse';

const plan={fileSha256:'a'.repeat(64),counts:{FILL:1},items:[]};
function upload(fields:Record<string,string>,bytes=Buffer.from('PK-synthetic')){
 const form=new FormData();form.set('file',new Blob([new Uint8Array(bytes)]),'NIPT export.xlsx');for(const [k,v] of Object.entries(fields))form.set(k,v);
 return new NextRequest('http://127.0.0.1/api/lab/his-anc-import',{method:'POST',body:form});
}
beforeEach(()=>{vi.clearAllMocks();calls.protect.mockResolvedValue({id:'actor',roles:['LAB_STAFF']});calls.preview.mockResolvedValue(plan);calls.apply.mockResolvedValue({...plan,applied:1,failed:[]});});

describe('HIS ANC import route',()=>{
 it('preview returns the plan for the uploaded bytes',async()=>{
  const r=await POST(upload({action:'preview'}));expect(r.status).toBe(200);expect(await r.json()).toEqual(plan);
  expect(calls.preview).toHaveBeenCalledWith({},expect.objectContaining({id:'actor'}),Buffer.from('PK-synthetic'),Buffer.alloc(32,7));
 });
 it('apply passes the previewed file hash',async()=>{
  const r=await POST(upload({action:'apply',sha256:plan.fileSha256}));expect(r.status).toBe(200);expect((await r.json()).applied).toBe(1);
  expect(calls.apply).toHaveBeenCalledWith({},expect.anything(),Buffer.from('PK-synthetic'),Buffer.alloc(32,7),plan.fileSha256);
 });
 it('an unknown action is refused',async()=>{const r=await POST(upload({action:'delete'}));expect(r.status).toBe(422);expect(calls.preview).not.toHaveBeenCalled();});
 it('a file problem is shown in Thai with its code',async()=>{
  calls.preview.mockRejectedValue(new HisAncError('HEADER_MISMATCH'));
  const r=await POST(upload({action:'preview'}));expect(r.status).toBe(422);const body=await r.json();expect(body.code).toBe('HEADER_MISMATCH');expect(body.error).toMatch(/คอลัมน์/);
 });
 it('an unauthenticated request never reaches the import',async()=>{
  calls.protect.mockRejectedValue(new Error('UNAUTHENTICATED'));const r=await POST(upload({action:'preview'}));expect(r.status).toBe(401);expect(calls.preview).not.toHaveBeenCalled();
 });
 it('a file over 2000 rows is told so in Thai',async()=>{
  calls.preview.mockRejectedValue(new HisAncError('TOO_MANY_ROWS'));
  const body=await (await POST(upload({action:'preview'}))).json();expect(body.code).toBe('TOO_MANY_ROWS');expect(body.error).toMatch(/2,000 แถว/);
 });
});
