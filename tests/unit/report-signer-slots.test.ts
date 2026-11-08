import {describe,it,expect,vi} from 'vitest';
import {signaturePng} from '../../tools/task3-uat/signature';
import type {Staff} from '../../packages/lab/core';

vi.mock('../../packages/readygen/signers',async orig=>({...await orig<typeof import('../../packages/readygen/signers')>(),signerAuthority:vi.fn(async(_d:unknown,_u:unknown,id:string,role:string)=>({profile:{id:'p',user_id:id,version:1,legal_name:'Synthetic Signer',mt_license_no:'12345',signature_sha256:'a'.repeat(64),signature_media:'image/png'},basis:'SELF',delegationId:null,authorityReference:null,operatorId:id,role,checkedAt:'2026-11-01T00:00:00.000Z'}))}));
import {signerSlots} from '../../packages/readygen/reports';

describe('signerSlots (final)',()=>{
 const user={id:'00000000-0000-4000-8000-000000000001',roles:['LAB_STAFF'],unitIds:[],permissions:[]} as unknown as Staff;
 const pick={reportedBy:'00000000-0000-4000-8000-000000000001',approvedBy:'00000000-0000-4000-8000-000000000001'};
 it('a final report whose stored signature is empty is refused with REPORT_SIGNATURE_MISSING',async()=>{
  const store={get:async()=>Buffer.alloc(0)} as never;
  await expect(signerSlots({} as never,user,store,pick,true)).rejects.toMatchObject({code:'REPORT_SIGNATURE_MISSING'});
 });
 it('a stored signature gives the slot its decoded size',async()=>{
  const store={get:async()=>signaturePng(1,240,80)} as never;
  const r=await signerSlots({} as never,user,store,pick,true);
  expect(r.reported.slot.signature).toMatchObject({media:'image/png',width:240,height:80});
 });
});
